/**
 * @module app.desktop_alt.Controller
 */
/**
 * Application entry point.
 *
 * This file includes `goog.require`'s for all the components/directives used
 * by the HTML page and the controller to provide the configuration.
 */

import './sass/desktop_alt.scss';
import gmfControllersAbstractDesktopController from 'gmf/controllers/AbstractDesktopController.js';
import appBase from '../appmodule.js';
import gmfImportModule from 'gmf/import/module.js';
import ngeoGooglestreetviewModule from 'ngeo/googlestreetview/module.js';
import ngeoRoutingModule from 'ngeo/routing/module.js';
import EPSG2056 from '@geoblocks/proj/src/EPSG_2056.js';
import EPSG21781 from '@geoblocks/proj/src/EPSG_21781.js';
import ngeoStatemanagerWfsPermalink from 'ngeo/statemanager/WfsPermalink.js';
import {inherits as olUtilInherits} from 'ol/util.js';
import Raven from 'raven-js/src/raven.js';
import RavenPluginsAngular from 'raven-js/plugins/angular.js';

if (!window.requestAnimationFrame) {
  alert('Your browser is not supported, please update it or use another one. You will be redirected.\n\n'
    + 'Votre navigateur n\'est pas supporté, veuillez le mettre à jour ou en utiliser un autre. Vous allez être redirigé.\n\n'
    + 'Ihr Browser wird nicht unterstützt, bitte aktualisieren Sie ihn oder verwenden Sie einen anderen. Sie werden weitergeleitet.');
  window.location = 'http://geomapfish.org/';
}

/**
 * @param {angular.IScope} $scope Scope.
 * @param {angular.auto.IInjectorService} $injector Main injector.
 * @param {gettext} gettext The gettext service
 * @constructor
 * @extends {gmf.controllers.AbstractDesktopController}
 * @ngInject
 * @export
 */
const exports = function($scope, $injector, gettext) {
  gmfControllersAbstractDesktopController.call(this, {
    srid: 21781,
    mapViewConfig: {
      center: [632464, 185457],
      zoom: 3,
      resolutions: [250, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05]
    }
  }, $scope, $injector);

  /**
   * @type {Array.<string>}
   * @export
   */
  this.searchCoordinatesProjections = [EPSG21781, EPSG2056, 'EPSG:4326'];

  /**
   * @type {number}
   * @export
   */
  this.searchDelay = 500;

  /**
   * @type {boolean}
   * @export
   */
  this.showInfobar = true;

  /**
   * @type {!Array.<number>}
   * @export
   */
  this.scaleSelectorValues = [250000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 250, 100, 50];

  /**
   * @type {Array.<string>}
   * @export
   */
  this.elevationLayers = ['srtm'];

  /**
   * @type {Object.<string, gmf.raster.component.LayerConfig>}
   * @export
   */
  this.elevationLayersConfig = {};

  /**
   * @type {Object.<string, gmfx.ProfileLineConfiguration>}
   * @export
   */
  this.profileLinesconfiguration = {
    'srtm': {}
  };

  /**
   * @type {Array.<gmfx.MousePositionProjection>}
   * @export
   */
  this.mousePositionProjections = [{
    code: 'EPSG:2056',
    label: 'CH1903+ / LV95',
    filter: 'ngeoNumberCoordinates::{x}, {y} m'
  }, {
    code: 'EPSG:21781',
    label: 'CH1903 / LV03',
    filter: 'ngeoNumberCoordinates::{x}, {y} m'
  }, {
    code: 'EPSG:4326',
    label: 'WGS84',
    filter: 'ngeoDMSCoordinates:2'
  }];

  /**
   * @type {gmfx.GridMergeTabs}
   * @export
   */
  this.gridMergeTabs = {
    'OSM_time_merged': ['osm_time', 'osm_time2'],
    'transport (merged)': ['fuel', 'parking'],
    'Learning [merged]': ['information', 'bus_stop']
  };

  // Allow angular-gettext-tools to collect the strings to translate
  /** @type {angular.gettext.gettextCatalog} */
  const gettextCatalog = $injector.get('gettextCatalog');
  gettextCatalog.getString('OSM_time_merged');
  gettextCatalog.getString('OSM_time (merged)');
  gettextCatalog.getString('Learning [merged]');
  gettextCatalog.getString('Add a theme');
  gettextCatalog.getString('Add a sub theme');
  gettextCatalog.getString('Add a layer');

  /**
   * @type {string}
   * @export
   */
  this.bgOpacityOptions = 'Test aus Olten';

  if ($injector.has('sentryUrl')) {
    const options = $injector.has('sentryOptions') ? $injector.get('sentryOptions') : undefined;
    const raven = new Raven();
    raven.config($injector.get('sentryUrl'), options)
      .addPlugin(RavenPluginsAngular)
      .install();
  }
};

olUtilInherits(exports, gmfControllersAbstractDesktopController);


/**
 * @param {jQuery.Event} event keydown event.
 * @export
 */
exports.prototype.onKeydown = function(event) {
  if (event.ctrlKey && event.key === 'p') {
    this.printPanelActive = true;
    event.preventDefault();
  }
};


exports.module = angular.module('Appdesktop_alt', [
  appBase.module.name,
  gmfControllersAbstractDesktopController.module.name,
  gmfImportModule.name,
  ngeoRoutingModule.name,
  ngeoGooglestreetviewModule.name,
  ngeoStatemanagerWfsPermalink.module.name,
]);

exports.module.controller('AlternativeDesktopController', exports);

export default exports;
