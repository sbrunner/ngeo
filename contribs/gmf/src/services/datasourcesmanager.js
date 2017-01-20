// TODO - Do not always remove all data sources from the ngeo collection

goog.provide('gmf.DataSourcesManager');

goog.require('gmf');
goog.require('gmf.TreeManager');
goog.require('ngeo.DataSource');
/** @suppress {extraRequire} */
goog.require('ngeo.DataSources');
goog.require('ol.obj');


gmf.DataSourcesManager = class {

  /**
   * The GeoMapFish DataSources Manager is responsible of listenening to the
   * c2cgeoportal's themes to create instances of `ngeo.DataSource` objects with
   * the layer definitions found and push them in the `ngeo.DataSources`
   * collection.
   *
   * When changing theme, these data sources are cleared then re-created.
   *
   * @struct
   * @param {angular.$q} $q Angular q service
   * @param {!angular.Scope} $rootScope Angular rootScope.
   * @param {angular.$timeout} $timeout Angular timeout service.
   * @param {gmf.Themes} gmfThemes The gmf Themes service.
   * @param {gmf.TreeManager} gmfTreeManager The gmf TreeManager service.
   * @param {ol.Collection.<ngeo.DataSource>} ngeoDataSources Ngeo collection
   *     of data sources objects.
   * @ngInject
   * @ngdoc service
   * @ngname gmfDataSourcesManager
   */
  constructor($q, $rootScope, $timeout, gmfThemes, gmfTreeManager,
      ngeoDataSources
  ) {

    // === Injected properties ===

    /**
     * @type {angular.$q}
     * @private
     */
    this.q_ = $q;

    /**
     * @type {!angular.Scope}
     * @private
     */
    this.rootScope_ = $rootScope;

    /**
     * @type {angular.$timeout}
     * @private
     */
    this.timeout_ = $timeout;

    /**
     * @type {gmf.Themes}
     * @private
     */
    this.gmfThemes_ = gmfThemes;

    /**
     * @type {gmf.TreeManager}
     * @private
     */
    this.gmfTreeManager_ = gmfTreeManager;

    /**
     * The collection of DataSources from ngeo, which gets updated by this
     * service. When the theme changes, first we remove all data sources, then
     * the 'active' data source are added here.
     * @type {ol.Collection.<ngeo.DataSource>}
     * @private
     */
    this.ngeoDataSources_ = ngeoDataSources;


    // === Inner properties ===

    /**
     * While loading a new theme, this is where all of the created data sources
     * are put using the id as key for easier find in the future.
     * @type {Object.<number, ngeo.DataSource>}
     * @private
     */
    this.dataSourcesCache_ = {};

    /**
     * The cache of layertree leaf controller, i.e. those that are added to
     * the tree manager. When treeCtrl is added in this cache, it's given
     * a reference to its according data source.
     * @type {gmf.DataSourcesManager.TreeCtrlCache}
     * @private
     */
    this.treeCtrlCache_ = {};

    /**
     * The function to call to unregister the `watchCollection` event on
     * the root layer tree controller children.
     * @type {?Function}
     * @private
     */
    this.treeCtrlsUnregister_ = null;

    // === Events ===

    ol.events.listen(this.gmfThemes_, gmf.ThemesEventType.CHANGE,
        this.handleThemesChange_, this);
  }

  /**
   * Called when the themes change. Remove any existing data sources first,
   * then create and add data sources from the loaded themes.
   * @private
   */
  handleThemesChange_() {
    // (1) Clear
    this.clearDataSources_();
    if (this.treeCtrlsUnregister_) {
      this.treeCtrlsUnregister_();
    }

    // (2) Re-create data sources and event listeners
    this.gmfThemes_.getOgcServersObject().then((ogcServers) => {
      const promiseThemes = this.gmfThemes_.getThemesObject().then((themes) => {
        // Create a DataSources for each theme
        for (const theme of themes) {
          for (const child of theme.children) {
            goog.asserts.assert(child);
            this.createDataSource_(child, child, ogcServers);
          }
        }
      });

      const promiseBgLayers = this.gmfThemes_.getBackgroundLayersObject().then((backgroundLayers) => {
        // Create a DataSource for each background layer
        for (const backgroundLayer of backgroundLayers) {
          this.createDataSource_(null, backgroundLayer, ogcServers);
        }
      });

      // Then add the data sources that are active in the ngeo collection
      this.q_.all([promiseThemes, promiseBgLayers]).then(() => {
        this.treeCtrlsUnregister_ = this.rootScope_.$watchCollection(() => {
          if (this.gmfTreeManager_.rootCtrl) {
            return this.gmfTreeManager_.rootCtrl.children;
          }
        }, (value) => {
          // Timeout required, because the collection event is fired before
          // the leaf nodes are created and they are the ones we're looking
          // for here.
          this.timeout_(() => {
            if (value) {
              this.clearTreeCtrlCache_();
              this.gmfTreeManager_.rootCtrl.traverseDepthFirst(
                this.addTreeCtrlToCache_.bind(this)
              );
            }
          });
        });
      });
    });
  }

  /**
   * Remove all data sources from the ngeo collection and from the cache.
   * @private
   */
  clearDataSources_() {
    this.ngeoDataSources_.clear();
    ol.obj.clear(this.dataSourcesCache_);
  }

  /**
   * Create a data source using the information on the node, group node
   * and OGC servers. If the node has children, then we loop in those to get
   * leaf nodes. Only leaf nodes end up creating a data source. If a data
   * source with the same id already exists, then the node is skipped.
   *
   * Once a data source is created, it is added to the data sources cache.
   *
   * @param {gmfThemes.GmfGroup} firstLevelGroup The first level group node.
   * @param {!gmfThemes.GmfGroup|!gmfThemes.GmfLayer} node The node, which
   *     may have children or not.
   * @param {!gmfThemes.GmfOgcServers} ogcServers OGC servers.
   * @private
   */
  createDataSource_(firstLevelGroup, node, ogcServers) {

    const children = node.children;

    // (1) Group node (node that has children). Loop in the children
    //     individually and create a data source for each one of them. The
    //     group node itself is **skipped**.
    if (children) {
      for (const child of children) {
        goog.asserts.assert(child);
        this.createDataSource_(firstLevelGroup, child, ogcServers);
      }
      return;
    }

    // From there on, the node is a layer node.
    const gmfLayer = /** @type gmfThemes.GmfLayer */ (node);

    // (2) Skip layer node if a data source with the same id exists
    const cache = this.dataSourcesCache_;
    const id = gmfLayer.id;
    if (cache[id]) {
      return;
    }

    // From there on, a data source will be created
    const meta = gmfLayer.metadata;
    const ogcType = gmfLayer.type;
    let maxResolution;
    let minResolution;
    let ogcLayers;
    let ogcServer;
    let wmtsLayer;
    let wmtsUrl;

    if (ogcType === gmf.Themes.NodeType.WMTS) {
      // (3) Manage WMTS

      // Common options for WMTS
      wmtsLayer = gmfLayer.layer;
      wmtsUrl = gmfLayer.url;
      maxResolution = meta.maxResolution;
      minResolution = meta.minResolution;

      // OGC Layers
      const layers = meta.queryLayers || meta.wmsLayers;
      if (layers) {
        ogcLayers = layers.split(',').map((layer) => {
          return {
            maxResolution,
            minResolution,
            name: layer,
            queryable: true
          };
        });
      }

      // OGC Server
      if (meta.ogcServer && ogcServers[meta.ogcServer]) {
        ogcServer = ogcServers[meta.ogcServer];
      }
    } else if (ogcType === gmf.Themes.NodeType.WMS) {
      // (4) Manage WMS
      const gmfLayerWMS = /** @type {gmfThemes.GmfLayerWMS} */ (gmfLayer);

      // Common options for WMS
      maxResolution = gmfLayerWMS.maxResolutionHint;
      minResolution = gmfLayerWMS.minResolutionHint;

      // OGC Layers
      ogcLayers = gmfLayerWMS.childLayers.map((childLayer) => {
        return {
          maxResolution: childLayer.maxResolutionHint,
          minResolution: childLayer.minResolutionHint,
          name: childLayer.name,
          queryable: childLayer.queryable
        };
      });

      // OGC Server
      if (firstLevelGroup && firstLevelGroup.mixed) {
        goog.asserts.assert(gmfLayerWMS.ogcServer);
        ogcServer = ogcServers[/** @type string */ (gmfLayerWMS.ogcServer)];
      } else {
        goog.asserts.assert(firstLevelGroup.ogcServer);
        ogcServer = ogcServers[/** @type string */ (firstLevelGroup.ogcServer)];
      }
    }

    // (5) ogcServer
    const ogcServerType = ogcServer ? ogcServer.type : undefined;
    const wmsIsSingleTile = ogcServer ? ogcServer.isSingleTile : undefined;
    const wfsUrl = ogcServer && ogcServer.wfsSupport ?
          ogcServer.urlWfs : undefined;
    const wmsUrl = ogcServer ? ogcServer.url : undefined;

    // (6) Snapping
    const snappable = !!meta.snappingConfig;
    const snappingTolerance = meta.snappingConfig ?
          meta.snappingConfig.tolerance : undefined;
    const snappingToEdges = meta.snappingConfig ?
          meta.snappingConfig.edge : undefined;
    const snappingToVertice = meta.snappingConfig ?
          meta.snappingConfig.vertex : undefined;

    // (7) Common options
    const copyable = meta.copyable;
    const identifierAttribute = meta.identifierAttributeField;
    const name = gmfLayer.name;
    const ogcImageType = gmfLayer.imageType;
    const visible = meta.isChecked === true;

    // Create the data source and add it to the cache
    cache[id] = new ngeo.DataSource({
      copyable,
      id,
      identifierAttribute,
      maxResolution,
      minResolution,
      name,
      ogcImageType,
      ogcLayers,
      ogcServerType,
      ogcType,
      snappable,
      snappingTolerance,
      snappingToEdges,
      snappingToVertice,
      visible,
      wfsUrl,
      wmsIsSingleTile,
      wmsUrl,
      wmtsLayer,
      wmtsUrl
    });
  }

  /**
   * If the given Layertree controller is a 'leaf', add it to the cache.
   * Also, set its according data source. Finally, add the data source to
   * the ngeo collection.
   *
   * @param {ngeo.LayertreeController} treeCtrl Layertree controller to add
   * @private
   */
  addTreeCtrlToCache_(treeCtrl) {

    // Skip any Layertree controller that has a node that is not a leaf
    const node = /** @type {gmfThemes.GmfGroup|gmfThemes.GmfLayer} */ (
      treeCtrl.node);
    if (node.children) {
      return;
    }

    const id = node.id;
    const dataSource = this.dataSourcesCache_[id];
    if (dataSource) {
      treeCtrl.setDataSource(dataSource);
    }

    const stateWatcherUnregister = this.rootScope_.$watch(
      () => treeCtrl.getState(),
      this.handleTreeCtrlStateChange_.bind(this, treeCtrl)
    );

    this.treeCtrlCache_[id] = {
      stateWatcherUnregister,
      treeCtrl
    };

    this.ngeoDataSources_.push(dataSource);
  }

  /**
   * Clears the layer tree controller cache. At the same time, each item gets
   * its data source reference unset and state watcher unregistered.
   *
   * The data source gets also removed from the ngeo data sources collection.
   * @private
   */
  clearTreeCtrlCache_() {
    for (const id in this.treeCtrlCache_) {
      const item = this.treeCtrlCache_[id];
      const dataSource = item.treeCtrl.getDataSource();
      goog.asserts.assert(dataSource, 'DataSource should be set');
      this.ngeoDataSources_.remove(dataSource);
      item.treeCtrl.setDataSource(null);
      item.stateWatcherUnregister();
    }
    ol.obj.clear(this.treeCtrlCache_);
  }

  /**
   * Called when the state of a 'leaf' layertree controller changes.
   * Update the `visible` property of the data source according to the
   * state of the layertree controller.
   *
   * Note: The possible states can only be 'on' or 'off', because the
   * layertree controller being a 'leaf'.
   *
   * @param {ngeo.LayertreeController} treeCtrl The layer tree controller
   * @param {?string} newVal New state value
   * @private
   */
  handleTreeCtrlStateChange_(treeCtrl, newVal) {
    const dataSource = treeCtrl.getDataSource();
    goog.asserts.assert(dataSource, 'DataSource should be set');
    const visible = newVal === 'on';
    dataSource.visible = visible;
  }

};


/**
 * @typedef {Object<number, gmf.DataSourcesManager.TreeCtrlCacheItem>}
 */
gmf.DataSourcesManager.TreeCtrlCache;


/**
 * @typedef {{
 *     stateWatcherUnregister: (Function),
 *     treeCtrl: (ngeo.LayertreeController)
 * }}
 */
gmf.DataSourcesManager.TreeCtrlCacheItem;


gmf.module.service('gmfDataSourcesManager', gmf.DataSourcesManager);
