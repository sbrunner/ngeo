/**
 * @module ngeo.draw.module
 */
import * as angular from 'angular';
import ngeoDrawComponent from 'ngeo/draw/component.js';
import ngeoDrawController from 'ngeo/draw/Controller.js';
import ngeoDrawFeatures from 'ngeo/draw/features.js';
import ngeoDrawPoint from 'ngeo/draw/point.js';
import ngeoDrawRectangle from 'ngeo/draw/rectangle.js';
import ngeoDrawText from 'ngeo/draw/text.js';

/**
 * @type {!angular.IModule}
 */
export default angular.module('ngeoDrawModule', [
  ngeoDrawController.module.name,
  ngeoDrawComponent.name,
  ngeoDrawFeatures.name,
  ngeoDrawPoint.name,
  ngeoDrawRectangle.name,
  ngeoDrawText.name,
]);
