"use strict";
// == import typescene-async library
var _Async = require("typescene-async");
/** Library for asynchronous programming */
exports.Async = _Async;
/** Shortcut to @Async.observable decorator */
exports.observable = _Async.observable;
/** Shortcut to Async.observe function to quickly create an ObservableValue
  * from a getter function or Async.Promise instance, or an ObservableObject
  * from any other object */
exports.observe = _Async.observe;
// == import typescene-ui library
var _UI = require("typescene-ui");
/** Library for strongly typed web UIs */
exports.UI = _UI;
exports.__esModule = true;
exports["default"] = { Async: _Async, UI: _UI };
