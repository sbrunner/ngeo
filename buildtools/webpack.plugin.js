// The MIT License (MIT)
//
// Copyright (c) 2018-2022 Camptocamp SA
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the "Software"), to deal in
// the Software without restriction, including without limitation the rights to
// use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
// the Software, and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
// FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
// IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
// CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

const sassLoader = require('./webpack.scss-loader.js');
const nodeSass = require('node-sass');
const path = require('path');
const fs = require('fs-extra');
const co = require('co');
const replaceAsync = require('fast-sass-loader/lib/replace');
const utils = require('fast-sass-loader/lib/utils');
const loaderUtils = require('loader-utils');
const assert = require('assert');

const BOM_HEADER = '\uFEFF';
const EXT_PRECEDENCE = ['.scss', '.sass', '.css'];
const MATCH_URL_ALL = /url\(\s*(['"]?)([^ '"()]+)(\1)\s*\)/g;
const MATCH_IMPORTS = /@import\s+(['"])([^,;'"]+)(\1)(\s*,\s*(['"])([^,;'"]+)(\1))*\s*;/g;
const MATCH_FILES = /(['"])([^,;'"]+)(\1)/g;

/**
 * @param original
 * @param includePaths
 * @param transformers
 */
function getImportsToResolve(original, includePaths, transformers) {
  const extname = path.extname(original);
  let basename = path.basename(original, extname);
  const dirname = path.dirname(original);

  const imports = [];
  let names = [basename];
  let exts = [extname];
  const extensionPrecedence = [].concat(EXT_PRECEDENCE, Object.keys(transformers));

  if (!extname) {
    exts = extensionPrecedence;
  }
  if (extname && !extensionPrecedence.includes(extname)) {
    basename = path.basename(original);
    names = [basename];
    exts = extensionPrecedence;
  }
  if (!basename.startsWith('_')) {
    names.push(`_${basename}`);
  }

  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let i = 0; i < names.length; i++) {
    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let j = 0; j < exts.length; j++) {
      // search relative to original file
      imports.push(path.join(dirname, names[i] + exts[j]));

      // search in includePaths
      for (const includePath of includePaths) {
        imports.push(path.join(includePath, dirname, names[i] + exts[j]));
      }
    }
  }

  return imports;
}

let cache;

/**
 * @param opts
 * @param entry
 * @param resolve
 * @param level
 */
function* mergeSources(opts, entry, resolve, level) {
  level = level || 0;

  const includePaths = opts.includePaths;
  const transformers = opts.transformers;
  let content = false;

  if (typeof entry === 'object') {
    content = entry.content;
    entry = entry.file;
  } else {
    content = yield fs.readFile(entry, 'utf8');

    // fix BOM issue (only on windows)
    if (content.startsWith(BOM_HEADER)) {
      content = content.substring(BOM_HEADER.length);
    }
  }

  const ext = path.extname(entry);

  if (transformers[ext]) {
    content = transformers[ext](content);
  }

  if (opts.data) {
    content = `${opts.data}\n${content}`;
  }

  const entryDir = path.dirname(entry);

  // replace url(...)
  content = content.replace(MATCH_URL_ALL, (total, left, file, right) => {
    if (loaderUtils.isUrlRequest(file)) {
      // handle url(<loader>!<file>)
      const pos = file.lastIndexOf('!');
      if (pos >= 0) {
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        left += file.substring(0, pos + 1);
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        file = file.substring(pos + 1);
      }

      // test again
      if (loaderUtils.isUrlRequest(file)) {
        if (file.startsWith('~') || file.startsWith('data:')) {
          return total;
        }
        const absoluteFile = path.normalize(path.resolve(entryDir, file));
        // fix for windows path
        let relativeFile = path.relative(process.cwd(), absoluteFile).replace(/\\/g, '/');

        if (!relativeFile.startsWith('.')) {
          relativeFile = `./${relativeFile}`;
        }

        return `url(${left}${relativeFile}${right})`;
      } else {
        return total;
      }
    } else {
      return total;
    }
  });

  // find comments should after content.replace(...), otherwise the comments offset will be incorrect
  const commentRanges = utils.findComments(content);

  // replace @import "..."
  /**
   * @param total
   */
  function* importReplacer(total) {
    // if current import is in comments, then skip it
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const range = this;
    const found = commentRanges.find((commentRange) => {
      if (range.start >= commentRange[0] && range.end <= commentRange[1]) {
        return true;
      }
    });

    if (found) {
      return total;
    }

    const contents = [];
    let matched;

    // must reset lastIndex
    MATCH_FILES.lastIndex = 0;

    while ((matched = MATCH_FILES.exec(total))) {
      // eslint-disable-line
      const originalImport = matched[2].trim();
      if (!originalImport) {
        const err = new Error(`import file cannot be empty: "${total}" @${entry}`);

        err.file = entry;

        throw err;
      }

      const imports = getImportsToResolve(originalImport, includePaths, transformers);
      let resolvedImport;

      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < imports.length; i++) {
        // if imports[i] is absolute path, then use it directly
        if (path.isAbsolute(imports[i]) && fs.existsSync(imports[i])) {
          resolvedImport = imports[i];
        } else {
          try {
            const reqFile = loaderUtils.urlToRequest(imports[i], opts.root);

            resolvedImport = yield resolve(entryDir, reqFile);
            break;
          } catch (err) {
            // skip
          }
        }
      }

      if (!resolvedImport) {
        const err = new Error(`import file cannot be resolved: "${total}" @${entry}`);

        err.file = entry;

        throw err;
      }

      resolvedImport = path.normalize(resolvedImport);

      if (cache.indexOf(resolvedImport) < 0) {
        cache.push(resolvedImport);

        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        contents.push(yield mergeSources(opts, resolvedImport, resolve, level + 1));
      }
    }

    return contents.join('\n');
  }

  return yield replaceAsync(content, MATCH_IMPORTS, co.wrap(importReplacer));
}

/**
 * @param ctx
 */
function resolver(ctx) {
  return function (dir, importFile) {
    return new Promise((resolve, reject) => {
      ctx.resolve(dir, importFile, (err, resolvedFile) => {
        if (err) {
          reject(err);
        } else {
          resolve(resolvedFile);
        }
      });
    });
  };
}

/**
 * @param pluginOptions
 * @param usedContext
 * @param compilation
 * @param assetName
 * @param assetUrl
 * @param queryString
 * @param replacements
 */
function fillDependency(
  pluginOptions,
  usedContext,
  compilation,
  assetName,
  assetUrl,
  queryString,
  replacements
) {
  return (resolve, reject) => {
    if (assetUrl.startsWith('~')) {
      usedContext.resolve(usedContext.resourcePath, assetName, (err, resolvedFile) => {
        if (err) {
          console.log(err);
          reject(err);
        } else {
          fs.readFile(resolvedFile, (err, data) => {
            if (err) {
              console.log(err);
              reject(err);
            } else {
              usedContext.resourcePath = assetName;
              const name = loaderUtils.interpolateName(usedContext, pluginOptions.assetname, {
                content: data,
              });
              compilation.assets[name] = {
                source: () => data,
                size: () => data.length,
              };
              // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
              replacements[assetUrl] = name + queryString;
              resolve();
            }
          });
        }
      });
    } else {
      fs.readFile(assetName, (err, data) => {
        if (err) {
          console.log(err);
          reject(err);
        } else {
          usedContext.resourcePath = assetName;
          const name = loaderUtils.interpolateName(usedContext, pluginOptions.assetname, {
            content: data,
          });
          compilation.assets[name] = {
            source: () => data,
            size: () => data.length,
          };
          // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
          replacements[assetUrl] = name + queryString;
          resolve();
        }
      });
    }
  };
}

/**
 * @param text
 * @param replacements
 */
function doReplacement(text, replacements) {
  if (replacements) {
    for (const replacement of replacements) {
      text = text.replace(replacement[0], replacement[1]);
    }
  }
  return text;
}

/**
 * @param pluginOptions
 * @param usedContext
 * @param compilation
 * @param chunk
 * @param resolve
 * @param callback
 */
function manageContent(pluginOptions, usedContext, compilation, chunk, resolve, callback) {
  return async (contents) => {
    if (pluginOptions.tempfile) {
      fs.writeFile(pluginOptions.tempfile, contents);
    }

    try {
      const replacements = {};
      const promises = [];
      const options = Object.assign({}, pluginOptions.sassConfig, {
        data: doReplacement(contents, pluginOptions.preReplacements),
        functions: {},
      });
      // Double parse the Sass files to be able to return in a synchronous function things
      // that we can only get asynchronously.
      const preparseOptions = Object.assign({}, options);
      preparseOptions.functions['url($url)'] = function (url) {
        if (url.getValue().startsWith('data:')) {
          return url;
        }
        try {
          const assetUrl = url.getValue();
          if (assetUrl[0] == '~') {
            let assetName = assetUrl.substr(1);
            let queryString = '';
            const questionMarkIndex = assetName.indexOf('?');
            if (questionMarkIndex > 0) {
              queryString = assetName.substr(questionMarkIndex);
              assetName = assetName.substr(0, questionMarkIndex);
            } else {
              const sharpIndex = assetName.indexOf('#');
              if (sharpIndex > 0) {
                queryString = assetName.substr(sharpIndex);
                assetName = assetName.substr(0, sharpIndex);
              }
            }
            promises.push(
              new Promise(
                fillDependency(
                  pluginOptions,
                  usedContext,
                  compilation,
                  assetName,
                  assetUrl,
                  queryString,
                  replacements
                )
              )
            );
          } else {
            promises.push(
              new Promise(
                fillDependency(pluginOptions, usedContext, compilation, assetUrl, assetUrl, '', replacements)
              )
            );
          }
        } catch (e) {
          console.error(e.stack || e);
          callback(`SCSS plugin error, ${e}`);
        }
        return url;
      };
      const originalResourcePath = usedContext.resourcePath;
      nodeSass.renderSync(preparseOptions);
      await Promise.all(promises);
      const parseOptions = Object.assign({}, options);
      parseOptions.functions['url($url)'] = function (url) {
        const assetUrl = url.getValue();
        if (assetUrl.startsWith('data:')) {
          return nodeSass.types.String(`url(${assetUrl})`);
        }
        return nodeSass.types.String(`url(${replacements[assetUrl]})`);
      };
      const result = nodeSass.renderSync(parseOptions);
      const content = doReplacement(result.css.toString(), pluginOptions.postReplacements);
      const srcmap = result.map;
      const asset = {
        source: () => content,
        size: () => content.length,
      };
      usedContext.resourcePath = `/${chunk.name}`;
      const assetName = loaderUtils.interpolateName(usedContext, pluginOptions.filename, {
        content: content,
      });
      compilation.assets[assetName] = asset;
      chunk.files.push(assetName);
      if (srcmap) {
        compilation.assets[`${assetName}.map`] = {
          source: () => srcmap,
          size: () => srcmap.length,
        };
        chunk.files.push(`${assetName}.map`);
      }
      usedContext.resourcePath = originalResourcePath;
      resolve();
    } catch (e) {
      console.error(e.stack || e);
      callback(`SCSS plugin error, ${e}`);
    }
  };
}

/**
 * @param files
 */
function processAsset(files) {
  return (resolve, reject) => {
    try {
      const contents = [];
      const browse = function (position) {
        if (position < files.length) {
          const file = files[position];
          const entry = sassLoader.entries[file];
          if (entry) {
            const merged = mergeSources(
              entry.options,
              {
                file: file,
                content: entry.content,
              },
              resolver(entry.ctx)
            );
            const merged2 = [];
            for (const content of merged) {
              merged2.push(content);
            }
            assert.strictEqual(merged2.length, 1);
            merged2[0].then(
              (content) => {
                contents.push(content);
                position++;
                browse(position);
              },
              () => {
                reject(`${position}, ${file}`);
              }
            );
          } else {
            reject(`Missing entry for ${file}`);
          }
        } else {
          resolve(contents.join('\n'));
        }
      };
      browse(0);
    } catch (e) {
      console.error(e.stack || e);
      reject(e);
    }
  };
}

class SassPlugin {
  constructor(options) {
    this.options = options;
  }

  apply(compiler) {
    // compiler.hooks.emit.taplAsync('SassPlugin', async (compilation, callback) => {
    compiler.plugin('emit', async (compilation, callback) => {
      const chunksFiles = {};
      for (const chunk of compilation.chunks) {
        chunksFiles[chunk.name] = [];
        const files = chunksFiles[chunk.name];
        const browse = (module) => {
          if (module.children) {
            for (const child of module.children) {
              browse(child);
            }
          } else {
            if (module.resource && (module.resource.endsWith('.scss') || module.resource.endsWith('.css'))) {
              files.push(module.resource);
            }
          }
        };
        for (const module of chunk.modulesIterable) {
          browse(module);
        }
      }
      for (const chunk of compilation.chunks) {
        cache = [];
        const pluginOptions = this.options;
        const files = pluginOptions.filesOrder
          ? pluginOptions.filesOrder(chunk, chunksFiles)
          : chunksFiles[chunk.name];
        if (
          (!pluginOptions.blacklistedChunks || pluginOptions.blacklistedChunks.indexOf(chunk.name) < 0) &&
          files.length > 0
        ) {
          // eslint-disable-next-line no-unused-vars
          const promise = new Promise((resolve, reject) => {
            const usedContext = files.length > 0 ? sassLoader.entries[files[0]].ctx : undefined;
            const promise = new Promise(processAsset(files));

            promise.then(
              manageContent(pluginOptions, usedContext, compilation, chunk, resolve, callback),
              (error) => {
                callback(`SCSS dependencies error, ${error}`);
              }
            );
          });
          await Promise.all([promise]);
        }
      }
      callback();
    });
  }
}

module.exports = SassPlugin;
