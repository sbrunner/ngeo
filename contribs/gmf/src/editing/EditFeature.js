import angular from 'angular';
import olFormatGeoJSON from 'ol/format/GeoJSON.js';
import {appendParams as olUriAppendParams} from 'ol/uri.js';


/**
 * @typedef {Object} ComparisonFilter
 * @property property {string} The type of operator for the comparison filter.
 * @property operator {string} The name of the property for the comparison filter.
 * @property value {string} The value for the comparison filter that must match the combinaison of
 * the operator and property.
 * }}
 */


/**
 * Service that provides methods to get, insert, update and delete vector
 * features with the use of a GeoMapFish Protocol as back-end.
 *
 * The GeoJSON format is used when obtaining or sending features.
 *
 * @constructor
 * @param {angular.IHttpService} $http Angular http service.
 * @param {string} gmfLayersUrl Url to the GeoMapFish layers service.
 * @ngInject
 */
function EditFeature($http, gmfLayersUrl) {

  /**
   * @type {angular.IHttpService}
   * @private
   */
  this.http_ = $http;

  /**
   * Url to the GeoMapFish layers service. Required in applications that use:
   * - the editfeature tools
   * - the objectediting tools
   *
   * @type {string}
   * @private
   */
  this.baseUrl_ = gmfLayersUrl;

}


/**
 * Build a query to the MapFish protocol to fetch features from a list
 * of layer ids inside a specified extent.
 *
 * @param {Array.<number>} layerIds List of layer ids to get the features from.
 * @param {import("ol/extent.js").Extent} extent The extent where to get the features from.
 * @return {angular.IPromise} Promise.
 * @export
 */
EditFeature.prototype.getFeaturesInExtent = function(layerIds, extent) {
  const url = olUriAppendParams(`${this.baseUrl_}/${layerIds.join(',')}`, {
    'bbox': extent.join(',')
  });
  return this.http_.get(url).then(this.handleGetFeatures_.bind(this));
};


/**
 * Build a query to the MapFish protocol to fetch features from a list
 * of layer ids and a list of comparison filters.
 *
 * This method is called in the ObjectEditing service, which is injected in
 * the permalink service, i.e. it's always called. Since we don't have to
 * define the url to the GMF Protocol (layers) a dummy promise returns an
 * empty array of features if the url is not defined.
 *
 * @param {!Array.<number>} layerIds List of layer ids to get the features from.
 * @param {!Array.<!ComparisonFilter>} filters List of comparison filters
 * @return {angular.IPromise} Promise.
 */
EditFeature.prototype.getFeaturesWithComparisonFilters = function(
  layerIds, filters
) {
  const properties = [];
  const params = {};

  for (const filter of filters) {
    params[`${filter.property}__${filter.operator}`] = filter.value;
    properties.push(filter.property);
  }

  params['queryable'] = properties.join(',');

  const url = olUriAppendParams(`${this.baseUrl_}/${layerIds.join(',')}`, params);
  return this.http_.get(url).then(this.handleGetFeatures_.bind(this));
};


/**
 * @param {angular.IHttpResponse} resp Ajax response.
 * @return {Array.<import("ol/Feature.js").default>} List of features.
 * @private
 */
EditFeature.prototype.handleGetFeatures_ = function(resp) {
  return new olFormatGeoJSON().readFeatures(resp.data);
};


/**
 * @param {number} layerId The layer id that contains the feature.
 * @param {Array.<import("ol/Feature.js").default>} features List of features to insert.
 * @return {angular.IPromise} Promise.
 * @export
 */
EditFeature.prototype.insertFeatures = function(layerId, features) {
  const url = `${this.baseUrl_}/${layerId}`;
  const geoJSON = new olFormatGeoJSON().writeFeatures(features);
  return this.http_.post(url, geoJSON, {
    headers: {'Content-Type': 'application/json'},
    withCredentials: true
  });
};


/**
 * @param {number} layerId The layer id that contains the feature.
 * @param {import("ol/Feature.js").default} feature The feature to update.
 * @return {angular.IPromise} Promise.
 * @export
 */
EditFeature.prototype.updateFeature = function(layerId, feature) {
  const url = `${this.baseUrl_}/${layerId.toString()}/${feature.getId()}`;
  const geoJSON = new olFormatGeoJSON().writeFeature(feature);
  return this.http_.put(url, geoJSON, {
    headers: {'Content-Type': 'application/json'},
    withCredentials: true
  });
};


/**
 * @param {number} layerId The layer id that contains the feature.
 * @param {import("ol/Feature.js").default} feature The feature to delete.
 * @return {angular.IPromise} Promise.
 * @export
 */
EditFeature.prototype.deleteFeature = function(layerId, feature) {
  const url = `${this.baseUrl_}/${layerId.toString()}/${feature.getId()}`;
  return this.http_.delete(url, {
    headers: {'Content-Type': 'application/json'},
    withCredentials: true
  });
};


/**
 * @type {!angular.IModule}
 */
const module = angular.module('gmfEditFeature', []);
module.service('gmfEditFeature', EditFeature);


export default module;
