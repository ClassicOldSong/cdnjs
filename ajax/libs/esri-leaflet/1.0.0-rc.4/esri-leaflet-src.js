/*! esri-leaflet - v1.0.0-rc.4 - 2014-11-10
*   Copyright (c) 2014 Environmental Systems Research Institute, Inc.
*   Apache License*/
(function (factory) {
  //define an AMD module that relies on 'leaflet'
  if (typeof define === 'function' && define.amd) {
    define(['leaflet'], function (L) {
      return factory(L);
    });
  //define a common js module that relies on 'leaflet'
  } else if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('leaflet'));
  }

  if(typeof window !== 'undefined' && window.L){
    factory(window.L);
  }
}(function (L) {
var EsriLeaflet = { //jshint ignore:line
  VERSION: '1.0.0-rc.4',
  Layers: {},
  Services: {},
  Controls: {},
  Tasks: {},
  Util: {},
  Support: {
    CORS: !!(window.XMLHttpRequest && 'withCredentials' in new XMLHttpRequest()),
    pointerEvents: document.documentElement.style.pointerEvents === ''
  }
};

if(typeof window !== 'undefined' && window.L){
  window.L.esri = EsriLeaflet;
}


(function(EsriLeaflet){

  // shallow object clone for feature properties and attributes
  // from http://jsperf.com/cloning-an-object/2
  function clone(obj) {
    var target = {};
    for (var i in obj) {
      if (obj.hasOwnProperty(i)) {
        target[i] = obj[i];
      }
    }
    return target;
  }

  // checks if 2 x,y points are equal
  function pointsEqual(a, b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  // checks if the first and last points of a ring are equal and closes the ring
  function closeRing(coordinates) {
    if (!pointsEqual(coordinates[0], coordinates[coordinates.length - 1])) {
      coordinates.push(coordinates[0]);
    }
    return coordinates;
  }

  // determine if polygon ring coordinates are clockwise. clockwise signifies outer ring, counter-clockwise an inner ring
  // or hole. this logic was found at http://stackoverflow.com/questions/1165647/how-to-determine-if-a-list-of-polygon-
  // points-are-in-clockwise-order
  function ringIsClockwise(ringToTest) {
    var total = 0,i = 0;
    var rLength = ringToTest.length;
    var pt1 = ringToTest[i];
    var pt2;
    for (i; i < rLength - 1; i++) {
      pt2 = ringToTest[i + 1];
      total += (pt2[0] - pt1[0]) * (pt2[1] + pt1[1]);
      pt1 = pt2;
    }
    return (total >= 0);
  }

  // ported from terraformer.js https://github.com/Esri/Terraformer/blob/master/terraformer.js#L504-L519
  function vertexIntersectsVertex(a1, a2, b1, b2) {
    var uaT = (b2[0] - b1[0]) * (a1[1] - b1[1]) - (b2[1] - b1[1]) * (a1[0] - b1[0]);
    var ubT = (a2[0] - a1[0]) * (a1[1] - b1[1]) - (a2[1] - a1[1]) * (a1[0] - b1[0]);
    var uB  = (b2[1] - b1[1]) * (a2[0] - a1[0]) - (b2[0] - b1[0]) * (a2[1] - a1[1]);

    if ( uB !== 0 ) {
      var ua = uaT / uB;
      var ub = ubT / uB;

      if ( 0 <= ua && ua <= 1 && 0 <= ub && ub <= 1 ) {
        return true;
      }
    }

    return false;
  }

  // ported from terraformer.js https://github.com/Esri/Terraformer/blob/master/terraformer.js#L521-L531
  function arrayIntersectsArray(a, b) {
    for (var i = 0; i < a.length - 1; i++) {
      for (var j = 0; j < b.length - 1; j++) {
        if (vertexIntersectsVertex(a[i], a[i + 1], b[j], b[j + 1])) {
          return true;
        }
      }
    }

    return false;
  }

  // ported from terraformer.js https://github.com/Esri/Terraformer/blob/master/terraformer.js#L470-L480
  function coordinatesContainPoint(coordinates, point) {
    var contains = false;
    for(var i = -1, l = coordinates.length, j = l - 1; ++i < l; j = i) {
      if (((coordinates[i][1] <= point[1] && point[1] < coordinates[j][1]) ||
           (coordinates[j][1] <= point[1] && point[1] < coordinates[i][1])) &&
          (point[0] < (coordinates[j][0] - coordinates[i][0]) * (point[1] - coordinates[i][1]) / (coordinates[j][1] - coordinates[i][1]) + coordinates[i][0])) {
        contains = !contains;
      }
    }
    return contains;
  }

  // ported from terraformer-arcgis-parser.js https://github.com/Esri/terraformer-arcgis-parser/blob/master/terraformer-arcgis-parser.js#L106-L113
  function coordinatesContainCoordinates(outer, inner){
    var intersects = arrayIntersectsArray(outer, inner);
    var contains = coordinatesContainPoint(outer, inner[0]);
    if(!intersects && contains){
      return true;
    }
    return false;
  }

  // do any polygons in this array contain any other polygons in this array?
  // used for checking for holes in arcgis rings
  // ported from terraformer-arcgis-parser.js https://github.com/Esri/terraformer-arcgis-parser/blob/master/terraformer-arcgis-parser.js#L117-L172
  function convertRingsToGeoJSON(rings){
    var outerRings = [];
    var holes = [];
    var x; // iterator
    var outerRing; // current outer ring being evaluated
    var hole; // current hole being evaluated

    // for each ring
    for (var r = 0; r < rings.length; r++) {
      var ring = closeRing(rings[r].slice(0));
      if(ring.length < 4){
        continue;
      }
      // is this ring an outer ring? is it clockwise?
      if(ringIsClockwise(ring)){
        var polygon = [ ring ];
        outerRings.push(polygon); // push to outer rings
      } else {
        holes.push(ring); // counterclockwise push to holes
      }
    }

    var uncontainedHoles = [];

    // while there are holes left...
    while(holes.length){
      // pop a hole off out stack
      hole = holes.pop();

      // loop over all outer rings and see if they contain our hole.
      var contained = false;
      for (x = outerRings.length - 1; x >= 0; x--) {
        outerRing = outerRings[x][0];
        if(coordinatesContainCoordinates(outerRing, hole)){
          // the hole is contained push it into our polygon
          outerRings[x].push(hole);
          contained = true;
          break;
        }
      }

      // ring is not contained in any outer ring
      // sometimes this happens https://github.com/Esri/esri-leaflet/issues/320
      if(!contained){
        uncontainedHoles.push(hole);
      }
    }

    // if we couldn't match any holes using contains we can try intersects...
    while(uncontainedHoles.length){
      // pop a hole off out stack
      hole = uncontainedHoles.pop();

      // loop over all outer rings and see if any intersect our hole.
      var intersects = false;
      for (x = outerRings.length - 1; x >= 0; x--) {
        outerRing = outerRings[x][0];
        if(arrayIntersectsArray(outerRing, hole)){
          // the hole is contained push it into our polygon
          outerRings[x].push(hole);
          intersects = true;
          break;
        }
      }

      if(!intersects) {
        outerRings.push([hole.reverse()]);
      }
    }

    if(outerRings.length === 1){
      return {
        type: 'Polygon',
        coordinates: outerRings[0]
      };
    } else {
      return {
        type: 'MultiPolygon',
        coordinates: outerRings
      };
    }
  }

  // This function ensures that rings are oriented in the right directions
  // outer rings are clockwise, holes are counterclockwise
  // used for converting GeoJSON Polygons to ArcGIS Polygons
  function orientRings(poly){
    var output = [];
    var polygon = poly.slice(0);
    var outerRing = closeRing(polygon.shift().slice(0));
    if(outerRing.length >= 4){
      if(!ringIsClockwise(outerRing)){
        outerRing.reverse();
      }

      output.push(outerRing);

      for (var i = 0; i < polygon.length; i++) {
        var hole = closeRing(polygon[i].slice(0));
        if(hole.length >= 4){
          if(ringIsClockwise(hole)){
            hole.reverse();
          }
          output.push(hole);
        }
      }
    }

    return output;
  }

  // This function flattens holes in multipolygons to one array of polygons
  // used for converting GeoJSON Polygons to ArcGIS Polygons
  function flattenMultiPolygonRings(rings){
    var output = [];
    for (var i = 0; i < rings.length; i++) {
      var polygon = orientRings(rings[i]);
      for (var x = polygon.length - 1; x >= 0; x--) {
        var ring = polygon[x].slice(0);
        output.push(ring);
      }
    }
    return output;
  }

  // convert an extent (ArcGIS) to LatLngBounds (Leaflet)
  EsriLeaflet.Util.extentToBounds = function(extent){
    var sw = new L.LatLng(extent.ymin, extent.xmin);
    var ne = new L.LatLng(extent.ymax, extent.xmax);
    return new L.LatLngBounds(sw, ne);
  };

  // convert an LatLngBounds (Leaflet) to extent (ArcGIS)
  EsriLeaflet.Util.boundsToExtent = function(bounds) {
    bounds = L.latLngBounds(bounds);
    return {
      'xmin': bounds.getSouthWest().lng,
      'ymin': bounds.getSouthWest().lat,
      'xmax': bounds.getNorthEast().lng,
      'ymax': bounds.getNorthEast().lat,
      'spatialReference': {
        'wkid' : 4326
      }
    };
  };

  EsriLeaflet.Util.arcgisToGeojson = function (arcgis, idAttribute){
    var geojson = {};

    if(typeof arcgis.x === 'number' && typeof arcgis.y === 'number'){
      geojson.type = 'Point';
      geojson.coordinates = [arcgis.x, arcgis.y];
    }

    if(arcgis.points){
      geojson.type = 'MultiPoint';
      geojson.coordinates = arcgis.points.slice(0);
    }

    if(arcgis.paths) {
      if(arcgis.paths.length === 1){
        geojson.type = 'LineString';
        geojson.coordinates = arcgis.paths[0].slice(0);
      } else {
        geojson.type = 'MultiLineString';
        geojson.coordinates = arcgis.paths.slice(0);
      }
    }

    if(arcgis.rings) {
      geojson = convertRingsToGeoJSON(arcgis.rings.slice(0));
    }

    if(arcgis.geometry || arcgis.attributes) {
      geojson.type = 'Feature';
      geojson.geometry = (arcgis.geometry) ? EsriLeaflet.Util.arcgisToGeojson(arcgis.geometry) : null;
      geojson.properties = (arcgis.attributes) ? clone(arcgis.attributes) : null;
      if(arcgis.attributes) {
        geojson.id =  arcgis.attributes[idAttribute] || arcgis.attributes.OBJECTID || arcgis.attributes.FID;
      }
    }

    return geojson;
  };

  // GeoJSON -> ArcGIS
  EsriLeaflet.Util.geojsonToArcGIS = function(geojson, idAttribute){
    idAttribute = idAttribute || 'OBJECTID';
    var spatialReference = { wkid: 4326 };
    var result = {};
    var i;

    switch(geojson.type){
    case 'Point':
      result.x = geojson.coordinates[0];
      result.y = geojson.coordinates[1];
      result.spatialReference = spatialReference;
      break;
    case 'MultiPoint':
      result.points = geojson.coordinates.slice(0);
      result.spatialReference = spatialReference;
      break;
    case 'LineString':
      result.paths = [geojson.coordinates.slice(0)];
      result.spatialReference = spatialReference;
      break;
    case 'MultiLineString':
      result.paths = geojson.coordinates.slice(0);
      result.spatialReference = spatialReference;
      break;
    case 'Polygon':
      result.rings = orientRings(geojson.coordinates.slice(0));
      result.spatialReference = spatialReference;
      break;
    case 'MultiPolygon':
      result.rings = flattenMultiPolygonRings(geojson.coordinates.slice(0));
      result.spatialReference = spatialReference;
      break;
    case 'Feature':
      if(geojson.geometry) {
        result.geometry = EsriLeaflet.Util.geojsonToArcGIS(geojson.geometry, idAttribute);
      }
      result.attributes = (geojson.properties) ? clone(geojson.properties) : {};
      if(geojson.id){
        result.attributes[idAttribute] = geojson.id;
      }
      break;
    case 'FeatureCollection':
      result = [];
      for (i = 0; i < geojson.features.length; i++){
        result.push(EsriLeaflet.Util.geojsonToArcGIS(geojson.features[i], idAttribute));
      }
      break;
    case 'GeometryCollection':
      result = [];
      for (i = 0; i < geojson.geometries.length; i++){
        result.push(EsriLeaflet.Util.geojsonToArcGIS(geojson.geometries[i], idAttribute));
      }
      break;
    }

    return result;
  };

  EsriLeaflet.Util.responseToFeatureCollection = function(response, idAttribute){
    var objectIdField;

    if(idAttribute){
      objectIdField = idAttribute;
    } else if(response.objectIdFieldName){
      objectIdField = response.objectIdFieldName;
    } else if(response.fields) {
      for (var j = 0; j <= response.fields.length - 1; j++) {
        if(response.fields[j].type === 'esriFieldTypeOID') {
          objectIdField = response.fields[j].name;
          break;
        }
      }
    } else {
      objectIdField = 'OBJECTID';
    }

    var featureCollection = {
      type: 'FeatureCollection',
      features: []
    };
    var features = response.features || response.results;
    if(features.length){
      for (var i = features.length - 1; i >= 0; i--) {
        featureCollection.features.push(EsriLeaflet.Util.arcgisToGeojson(features[i], objectIdField));
      }
    }

    return featureCollection;
  };

    // trim whitespace and add a tailing slash is needed to a url
  EsriLeaflet.Util.cleanUrl = function(url){
    url = url.replace(/\s\s*/g, '');

    //add a trailing slash to the url if the user omitted it
    if(url[url.length-1] !== '/'){
      url += '/';
    }

    return url;
  };

  EsriLeaflet.Util.geojsonTypeToArcGIS = function (geoJsonType) {
    var arcgisGeometryType;
    switch (geoJsonType) {
    case 'Point':
      arcgisGeometryType = 'esriGeometryPoint';
      break;
    case 'MultiPoint':
      arcgisGeometryType = 'esriGeometryMultipoint';
      break;
    case 'LineString':
      arcgisGeometryType = 'esriGeometryPolyline';
      break;
    case 'MultiLineString':
      arcgisGeometryType = 'esriGeometryPolyline';
      break;
    case 'Polygon':
      arcgisGeometryType = 'esriGeometryPolygon';
      break;
    case 'MultiPolygon':
      arcgisGeometryType = 'esriGeometryPolygon';
      break;
    }
    return arcgisGeometryType;
  };

})(EsriLeaflet);

(function(EsriLeaflet){

  var callbacks = 0;

  window._EsriLeafletCallbacks = {};

  function serialize(params){
    var data = '';

    params.f = 'json';

    for (var key in params){
      if(params.hasOwnProperty(key)){
        var param = params[key];
        var type = Object.prototype.toString.call(param);
        var value;

        if(data.length){
          data += '&';
        }

        if(type === '[object Array]' || type === '[object Object]'){
          value = JSON.stringify(param);
        } else if (type === '[object Date]'){
          value = param.valueOf();
        } else {
          value = param;
        }

        data += encodeURIComponent(key) + '=' + encodeURIComponent(value);
      }
    }

    return data;
  }

  function createRequest(callback, context){
    var httpRequest = new XMLHttpRequest();

    httpRequest.onerror = function(e) {
      callback.call(context, {
        error: {
          code: 500,
          message: 'XMLHttpRequest error'
        }
      }, null);
    };

    httpRequest.onreadystatechange = function(){
      var response;
      var error;

      if (httpRequest.readyState === 4) {
        try {
          response = JSON.parse(httpRequest.responseText);
        } catch(e) {
          response = null;
          error = {
            code: 500,
            message: 'Could not parse response as JSON.'
          };
        }

        if (!error && response.error) {
          error = response.error;
          response = null;
        }

        callback.call(context, error, response);
      }
    };

    return httpRequest;
  }

  // AJAX handlers for CORS (modern browsers) or JSONP (older browsers)
  EsriLeaflet.Request = {
    request: function(url, params, callback, context){
      var paramString = serialize(params);
      var httpRequest = createRequest(callback, context);
      var requestLength = (url + '?' + paramString).length;

      // request is less then 2000 characters and the browser supports CORS, make GET request with XMLHttpRequest
      if(requestLength <= 2000 && L.esri.Support.CORS){
        httpRequest.open('GET', url + '?' + paramString);
        httpRequest.send(null);

      // request is less more then 2000 characters and the browser supports CORS, make POST request with XMLHttpRequest
      } else if (requestLength > 2000 && L.esri.Support.CORS){
        httpRequest.open('POST', url);
        httpRequest.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        httpRequest.send(paramString);

      // request is less more then 2000 characters and the browser does not support CORS, make a JSONP request
      } else if(requestLength <= 2000 && !L.esri.Support.CORS){
        return L.esri.Request.get.JSONP(url, params, callback, context);

      // request is longer then 2000 characters and the browser does not support CORS, log a warning
      } else {
        if(console && console.warn){
          console.warn('a request to ' + url + ' was longer then 2000 characters and this browser cannot make a cross-domain post request. Please use a proxy http://esri.github.io/esri-leaflet/api-reference/request.html');
          return;
        }
      }

      return httpRequest;
    },
    post: {
      XMLHTTP: function (url, params, callback, context) {
        var httpRequest = createRequest(callback, context);
        httpRequest.open('POST', url);
        httpRequest.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        httpRequest.send(serialize(params));

        return httpRequest;
      }
    },

    get: {
      CORS: function (url, params, callback, context) {
        var httpRequest = createRequest(callback, context);

        httpRequest.open('GET', url + '?' + serialize(params), true);
        httpRequest.send(null);

        return httpRequest;
      },
      JSONP: function(url, params, callback, context){
        var callbackId = 'c' + callbacks;

        params.callback = 'window._EsriLeafletCallbacks.' + callbackId;

        var script = L.DomUtil.create('script', null, document.body);
        script.type = 'text/javascript';
        script.src = url + '?' +  serialize(params);
        script.id = callbackId;

        window._EsriLeafletCallbacks[callbackId] = function(response){
          if(window._EsriLeafletCallbacks[callbackId] !== true){
            var error;
            var responseType = Object.prototype.toString.call(response);

            if(!(responseType === '[object Object]' || responseType === '[object Array]')){
              error = {
                error: {
                  code: 500,
                  message: 'Expected array or object as JSONP response'
                }
              };
              response = null;
            }

            if (!error && response.error) {
              error = response;
              response = null;
            }

            callback.call(context, error, response);
            window._EsriLeafletCallbacks[callbackId] = true;
          }
        };

        callbacks++;

        return {
          id: callbackId,
          url: script.src,
          abort: function(){
            window._EsriLeafletCallbacks._callback[callbackId]({
              code: 0,
              message: 'Request aborted.'
            });
          }
        };
      }
    }
  };

  // Choose the correct AJAX handler depending on CORS support
  EsriLeaflet.get = (EsriLeaflet.Support.CORS) ? EsriLeaflet.Request.get.CORS : EsriLeaflet.Request.get.JSONP;

  // Always use XMLHttpRequest for posts
  EsriLeaflet.post = EsriLeaflet.Request.post.XMLHTTP;

  // expose a common request method the uses GET\POST based on request length
  EsriLeaflet.request = EsriLeaflet.Request.request;

})(EsriLeaflet);

EsriLeaflet.Services.Service = L.Class.extend({

  includes: L.Mixin.Events,

  options: {
    proxy: false,
    useCors: EsriLeaflet.Support.CORS
  },

  initialize: function (url, options) {
    this.url = EsriLeaflet.Util.cleanUrl(url);
    this._requestQueue = [];
    this._authenticating = false;
    L.Util.setOptions(this, options);
  },

  get: function (path, params, callback, context) {
    return this._request('get', path, params, callback, context);
  },

  post: function (path, params, callback, context) {
    return this._request('post', path, params, callback, context);
  },

  request: function (path, params, callback, context) {
    return this._request('request', path, params, callback, context);
  },

  metadata: function (callback, context) {
    return this._request('get', '', {}, callback, context);
  },

  authenticate: function(token){
    this._authenticating = false;
    this.options.token = token;
    this._runQueue();
    return this;
  },

  _request: function(method, path, params, callback, context){
    this.fire('requeststart', {
      url: this.url + path,
      params: params,
      method: method
    });

    var wrappedCallback = this._createServiceCallback(method, path, params, callback, context);

    if (this.options.token) {
      params.token = this.options.token;
    }

    if (this._authenticating) {
      this._requestQueue.push([method, path, params, callback, context]);
      return;
    } else {
      var url = (this.options.proxy) ? this.options.proxy + '?' + this.url + path : this.url + path;

      if((method === 'get' || method === 'request') && !this.options.useCors){
        return EsriLeaflet.Request.get.JSONP(url, params, wrappedCallback);
      } else {
        return EsriLeaflet[method](url, params, wrappedCallback);
      }
    }
  },

  _createServiceCallback: function(method, path, params, callback, context){
    var request = [method, path, params, callback, context];

    return L.Util.bind(function(error, response){

      if (error && (error.code === 499 || error.code === 498)) {
        this._authenticating = true;

        this._requestQueue.push(request);

        this.fire('authenticationrequired', {
          authenticate: L.Util.bind(this.authenticate, this)
        });
      } else {
        callback.call(context, error, response);

        if(error) {
          this.fire('requesterror', {
            url: this.url + path,
            params: params,
            message: error.message,
            code: error.code,
            method: method
          });
        } else {
          this.fire('requestsuccess', {
            url: this.url + path,
            params: params,
            response: response,
            method: method
          });
        }

        this.fire('requestend', {
          url: this.url + path,
          params: params,
          method: method
        });
      }
    }, this);
  },

  _runQueue: function(){
    for (var i = this._requestQueue.length - 1; i >= 0; i--) {
      var request = this._requestQueue[i];
      var method = request.shift();
      this[method].apply(this, request);
    }
    this._requestQueue = [];
  }

});

EsriLeaflet.Services.service = function(url, params){
  return new EsriLeaflet.Services.Service(url, params);
};

EsriLeaflet.Services.FeatureLayer = EsriLeaflet.Services.Service.extend({

  options: {
    idAttribute: 'OBJECTID'
  },

  query: function(){
    return new EsriLeaflet.Tasks.Query(this);
  },

  addFeature: function(feature, callback, context) {
    delete feature.id;

    feature = EsriLeaflet.Util.geojsonToArcGIS(feature);

    return this.post('addFeatures', {
      features: [feature]
    }, function(error, response){
      var result = (response && response.addResults) ? response.addResults[0] : undefined;
      if(callback){
        callback.call(this, error || response.addResults[0].error, result);
      }
    }, context);
  },

  updateFeature: function(feature, callback, context) {
    feature = EsriLeaflet.Util.geojsonToArcGIS(feature, this.options.idAttribute);

    return this.post('updateFeatures', {
      features: [feature]
    }, function(error, response){
      var result = (response && response.updateResults) ? response.updateResults[0] : undefined;
      if(callback){
        callback.call(context, error || response.updateResults[0].error, result);
      }
    }, context);
  },

  deleteFeature: function(id, callback, context) {
    return this.post('deleteFeatures', {
      objectIds: id
    }, function(error, response){
      var result = (response && response.deleteResults) ? response.deleteResults[0] : undefined;
      if(callback){
        callback.call(context, error || response.deleteResults[0].error, result);
      }
    }, context);
  }

});

EsriLeaflet.Services.featureLayer = function(url, options) {
  return new EsriLeaflet.Services.FeatureLayer(url, options);
};

EsriLeaflet.Services.MapService = EsriLeaflet.Services.Service.extend({

  identify: function () {
    return new EsriLeaflet.Tasks.identifyFeatures(this);
  },

  find: function () {
    return new EsriLeaflet.Tasks.Find(this);
  },

  query: function () {
    return new EsriLeaflet.Tasks.Query(this);
  }

});

EsriLeaflet.Services.mapService = function(url, params){
  return new EsriLeaflet.Services.MapService(url, params);
};

EsriLeaflet.Services.ImageService = EsriLeaflet.Services.Service.extend({

  query: function () {
    return new EsriLeaflet.Tasks.Query(this);
  },

  identify: function() {
    return new EsriLeaflet.Tasks.IdentifyImage(this);
  }
});

EsriLeaflet.Services.imageService = function(url, params){
  return new EsriLeaflet.Services.ImageService(url, params);
};

EsriLeaflet.Tasks.Task = L.Class.extend({

  options: {
    proxy: false,
    useCors: EsriLeaflet.Support.CORS
  },

  //Generate a method for each methodName:paramName in the setters for this task.
  generateSetter: function(param, context){
    var isArray = param.match(/([a-zA-Z]+)\[\]/);

    param = (isArray) ? isArray[1] : param;

    if(isArray){
      return L.Util.bind(function(value){
        // this.params[param] = (this.params[param]) ? this.params[param] + ',' : '';
        if (L.Util.isArray(value)) {
          this.params[param] = value.join(',');
        } else {
          this.params[param] = value;
        }
        return this;
      }, context);
    } else {
      return L.Util.bind(function(value){
        this.params[param] = value;
        return this;
      }, context);
    }
  },

  initialize: function(endpoint, options){
    // endpoint can be either a url to an ArcGIS Rest Service or an instance of EsriLeaflet.Service
    if(endpoint.url && endpoint.request){
      this._service = endpoint;
      this.url = endpoint.url;
    } else {
      this.url = EsriLeaflet.Util.cleanUrl(endpoint);
    }

    // clone default params into this object
    this.params = L.Util.extend({}, this.params || {});

    // generate setter methods based on the setters object implimented a child class
    if(this.setters){
      for (var setter in this.setters){
        var param = this.setters[setter];
        this[setter] = this.generateSetter(param, this);
      }
    }

    L.Util.setOptions(this, options);
  },

  token: function(token){
    if(this._service){
      this._service.authenticate(token);
    } else {
      this.params.token = token;
    }
    return this;
  },

  request: function(callback, context){
    if(this._service){
      return this._service.request(this.path, this.params, callback, context);
    } else {
      return this._request('request', this.path, this.params, callback, context);
    }
  },

  _request: function(method, path, params, callback, context){
    var url = (this.options.proxy) ? this.options.proxy + '?' + this.url + path : this.url + path;
    if((method === 'get' || method === 'request') && !this.options.useCors){
      return EsriLeaflet.Request.get.JSONP(url, params, callback, context);
    } else{
      return EsriLeaflet[method](url, params, callback, context);
    }
  }
});

EsriLeaflet.Tasks.Query = EsriLeaflet.Tasks.Task.extend({
  setters: {
    'offset': 'offset',
    'limit': 'limit',
    'outFields': 'fields[]',
    'precision': 'geometryPrecision',
    'featureIds': 'objectIds[]',
    'returnGeometry': 'returnGeometry',
    'token': 'token'
  },

  path: 'query',

  params: {
    returnGeometry: true,
    where: '1=1',
    outSr: 4326,
    outFields: '*'
  },

  within: function(geometry){
    this._setGeometry(geometry);
    this.params.spatialRel = 'esriSpatialRelContains'; // will make code read layer within geometry, to the api this will reads geometry contains layer
    return this;
  },

  intersects: function(geometry){
    this._setGeometry(geometry);
    this.params.spatialRel = 'esriSpatialRelIntersects';
    return this;
  },

  contains: function(geometry){
    this._setGeometry(geometry);
    this.params.spatialRel = 'esriSpatialRelWithin'; // will make code read layer contains geometry, to the api this will reads geometry within layer
    return this;
  },

  // crosses: function(geometry){
  //   this._setGeometry(geometry);
  //   this.params.spatialRel = 'esriSpatialRelCrosses';
  //   return this;
  // },

  // touches: function(geometry){
  //   this._setGeometry(geometry);
  //   this.params.spatialRel = 'esriSpatialRelTouches';
  //   return this;
  // },

  overlaps: function(geometry){
    this._setGeometry(geometry);
    this.params.spatialRel = 'esriSpatialRelOverlaps';
    return this;
  },

  // only valid for Feature Services running on ArcGIS Server 10.3 or ArcGIS Online
  nearby: function(latlng, radius){
    latlng = L.latLng(latlng);
    this.params.geometry = ([latlng.lng,latlng.lat]).join(',');
    this.params.geometryType = 'esriGeometryPoint';
    this.params.spatialRel = 'esriSpatialRelIntersects';
    this.params.units = 'esriSRUnit_Meter';
    this.params.distance = radius;
    this.params.inSr = 4326;
    return this;
  },

  where: function(string){
    this.params.where = string.replace(/"/g, "\'"); // jshint ignore:line
    return this;
  },

  between: function(start, end){
    this.params.time = ([start.valueOf(), end.valueOf()]).join();
    return this;
  },

  fields: function (fields) {
    if (L.Util.isArray(fields)) {
      this.params.outFields = fields.join(',');
    } else {
      this.params.outFields = fields;
    }
    return this;
  },

  simplify: function(map, factor){
    var mapWidth = Math.abs(map.getBounds().getWest() - map.getBounds().getEast());
    this.params.maxAllowableOffset = (mapWidth / map.getSize().y) * factor;
    return this;
  },

  orderBy: function(fieldName, order){
    order = order || 'ASC';
    this.params.orderByFields = (this.params.orderByFields) ? this.params.orderByFields + ',' : '';
    this.params.orderByFields += ([fieldName, order]).join(' ');
    return this;
  },

  returnGeometry: function(bool){
    this.params.returnGeometry = bool;
    return this;
  },

  run: function(callback, context){
    this._cleanParams();
    return this.request(function(error, response){
      callback.call(context, error, (response && EsriLeaflet.Util.responseToFeatureCollection(response)), response);
    }, context);
  },

  count: function(callback, context){
    this._cleanParams();
    this.params.returnCountOnly = true;
    return this.request(function(error, response){
      callback.call(this, error, (response && response.count), response);
    }, context);
  },

  ids: function(callback, context){
    this._cleanParams();
    this.params.returnIdsOnly = true;
    return this.request(function(error, response){
      callback.call(this, error, (response && response.objectIds), response);
    }, context);
  },

  // only valid for Feature Services running on ArcGIS Server 10.3 or ArcGIS Online
  bounds: function(callback, context){
    this._cleanParams();
    this.params.returnExtentOnly = true;
    return this.request(function(error, response){
      callback.call(context, error, (response && response.extent && EsriLeaflet.Util.extentToBounds(response.extent)), response);
    }, context);
  },

  // only valid for image services
  pixelSize: function(point){
    point = L.point(point);
    this.params.pixelSize = ([point.x,point.y]).join(',');
    return this;
  },

  // only valid for map services
  layer: function(layer){
    this.path = layer + '/query';
    return this;
  },

  _cleanParams: function(){
    delete this.params.returnIdsOnly;
    delete this.params.returnExtentOnly;
    delete this.params.returnCountOnly;
  },

  _setGeometry: function(geometry) {
    this.params.inSr = 4326;

    // convert bounds to extent and finish
    if ( geometry instanceof L.LatLngBounds ) {
      // set geometry + geometryType
      this.params.geometry = EsriLeaflet.Util.boundsToExtent(geometry);
      this.params.geometryType = 'esriGeometryEnvelope';
      return;
    }

    // convert L.Marker > L.LatLng
    if(geometry.getLatLng){
      geometry = geometry.getLatLng();
    }

    // convert L.LatLng to a geojson point and continue;
    if (geometry instanceof L.LatLng) {
      geometry = {
        type: 'Point',
        coordinates: [geometry.lng, geometry.lat]
      };
    }

    // handle L.GeoJSON, pull out the first geometry
    if ( geometry instanceof L.GeoJSON ) {
      //reassign geometry to the GeoJSON value  (we are assuming that only one feature is present)
      geometry = geometry.getLayers()[0].feature.geometry;
      this.params.geometry = EsriLeaflet.Util.geojsonToArcGIS(geometry);
      this.params.geometryType = EsriLeaflet.Util.geojsonTypeToArcGIS(geometry.type);
    }

    // Handle L.Polyline and L.Polygon
    if (geometry.toGeoJSON) {
      geometry = geometry.toGeoJSON();
    }

    // handle GeoJSON feature by pulling out the geometry
    if ( geometry.type === 'Feature' ) {
      // get the geometry of the geojson feature
      geometry = geometry.geometry;
    }

    // confirm that our GeoJSON is a point, line or polygon
    if ( geometry.type === 'Point' ||  geometry.type === 'LineString' || geometry.type === 'Polygon') {
      this.params.geometry = EsriLeaflet.Util.geojsonToArcGIS(geometry);
      this.params.geometryType = EsriLeaflet.Util.geojsonTypeToArcGIS(geometry.type);
      return;
    }

    // warn the user if we havn't found a
    /* global console */
    if(console && console.warn) {
      console.warn('invalid geometry passed to spatial query. Should be an L.LatLng, L.LatLngBounds or L.Marker or a GeoJSON Point Line or Polygon object');
    }

    return;
  }
});

EsriLeaflet.Tasks.query = function(url, params){
  return new EsriLeaflet.Tasks.Query(url, params);
};

EsriLeaflet.Tasks.Find = EsriLeaflet.Tasks.Task.extend({
  setters: {
    // method name > param name
    'contains': 'contains',
    'text': 'searchText',
    'fields': 'searchFields[]', // denote an array or single string
    'spatialReference': 'sr',
    'sr': 'sr',
    'layers': 'layers[]',
    'returnGeometry': 'returnGeometry',
    'maxAllowableOffset': 'maxAllowableOffset',
    'precision': 'geometryPrecision',
    'dynamicLayers': 'dynamicLayers',
    'returnZ' : 'returnZ',
    'returnM' : 'returnM',
    'gdbVersion' : 'gdbVersion',
    'token' : 'token'
  },

  path: 'find',

  params: {
    sr: 4326,
    contains: true,
    returnGeometry: true,
    returnZ: true,
    returnM: false
  },

  layerDefs: function (id, where) {
    this.params.layerDefs = (this.params.layerDefs) ? this.params.layerDefs + ';' : '';
    this.params.layerDefs += ([id, where]).join(':');
    return this;
  },

  simplify: function(map, factor){
    var mapWidth = Math.abs(map.getBounds().getWest() - map.getBounds().getEast());
    this.params.maxAllowableOffset = (mapWidth / map.getSize().y) * factor;
    return this;
  },

  run: function (callback, context) {
    return this.request(function(error, response){
      callback.call(context, error, (response && EsriLeaflet.Util.responseToFeatureCollection(response)), response);
    }, context);
  }
});

EsriLeaflet.Tasks.find = function (url, params) {
  return new EsriLeaflet.Tasks.Find(url, params);
};

EsriLeaflet.Tasks.Identify = EsriLeaflet.Tasks.Task.extend({
  path: 'identify',

  between: function(start, end){
    this.params.time = ([start.valueOf(), end.valueOf()]).join(',');
    return this;
  },

  returnGeometry: function (returnGeometry) {
    this.params.returnGeometry = returnGeometry;
    return this;
  }
});


EsriLeaflet.Tasks.IdentifyImage = EsriLeaflet.Tasks.Identify.extend({
  setters: {
    'setMosaicRule': 'mosaicRule',
    'setRenderingRule': 'renderingRule',
    'returnCatalogItems': 'returnCatalogItems'
  },

  params: {
    returnGeometry: false
  },

  at: function(latlng){
    latlng = L.latLng(latlng);
    this.params.geometry = JSON.stringify({
      x: latlng.lng,
      y: latlng.lat,
      spatialReference:{
        wkid: 4326
      }
    });
    this.params.geometryType = 'esriGeometryPoint';
    return this;
  },

  getMosaicRule: function() {
    return this.params.mosaicRule;
  },

  getRenderingRule: function() {
    return this.params.renderingRule;
  },

  setPixelSize: function(pixelSize) {
    this.params.pixelSize = pixelSize.join ? pixelSize.join(',') : pixelSize;
    return this;
  },

  getPixelSize: function() {
    return this.params.pixelSize;
  },

  run: function (callback, context){
    return this.request(function(error, response){
      callback.call(context, error, (response && this._responseToGeoJSON(response)), response);
    }, this);
  },

  // get pixel data and return as geoJSON point
  // populate catalog items (if any)
  // merging in any catalogItemVisibilities as a propery of each feature
  _responseToGeoJSON: function(response) {
    var location = response.location;
    var catalogItems = response.catalogItems;
    var catalogItemVisibilities = response.catalogItemVisibilities;
    var geoJSON =  {
      'pixel': {
        'type': 'Feature',
        'geometry': {
          'type': 'Point',
          'coordinates': [location.x, location.y]
        },
        'crs': {
          'type': 'EPSG',
          'properties': {
            'code': location.spatialReference.wkid
          }
        },
        'properties': {
          'OBJECTID': response.objectId,
          'name': response.name,
          'value': response.value
        },
        'id': response.objectId
      }
    };
    if (response.properties && response.properties.Values) {
      geoJSON.pixel.properties.values = response.properties.Values;
    }
    if (catalogItems && catalogItems.features) {
      geoJSON.catalogItems = EsriLeaflet.Util.responseToFeatureCollection(catalogItems);
      if (catalogItemVisibilities && catalogItemVisibilities.length === geoJSON.catalogItems.features.length) {
        for (var i = catalogItemVisibilities.length - 1; i >= 0; i--) {
          geoJSON.catalogItems.features[i].properties.catalogItemVisibility = catalogItemVisibilities[i];
        }
      }
    }
    return geoJSON;
  }

});

EsriLeaflet.Tasks.identifyImage = function(url, params){
  return new EsriLeaflet.Tasks.IdentifyImage(url, params);
};

EsriLeaflet.Tasks.IdentifyFeatures = EsriLeaflet.Tasks.Identify.extend({
  setters: {
    'layers': 'layers',
    'precision': 'geometryPrecision',
    'tolerance': 'tolerance'
  },

  params: {
    sr: 4326,
    layers: 'all',
    tolerance: 3,
    returnGeometry: true
  },

  on: function(map){
    var extent = EsriLeaflet.Util.boundsToExtent(map.getBounds());
    var size = map.getSize();
    this.params.imageDisplay = [size.x, size.y, 96].join(',');
    this.params.mapExtent=([extent.xmin, extent.ymin, extent.xmax, extent.ymax]).join(',');
    return this;
  },

  at: function(latlng){
    latlng = L.latLng(latlng);
    this.params.geometry = ([latlng.lng, latlng.lat]).join(',');
    this.params.geometryType = 'esriGeometryPoint';
    return this;
  },

  layerDef: function (id, where){
    this.params.layerDefs = (this.params.layerDefs) ? this.params.layerDefs + ';' : '';
    this.params.layerDefs += ([id, where]).join(':');
    return this;
  },

  simplify: function(map, factor){
    var mapWidth = Math.abs(map.getBounds().getWest() - map.getBounds().getEast());
    this.params.maxAllowableOffset = (mapWidth / map.getSize().y) * (1 - factor);
    return this;
  },

  run: function (callback, context){
    return this.request(function(error, response){
      callback.call(context, error, (response && EsriLeaflet.Util.responseToFeatureCollection(response)), response);
    }, context);
  }

});

EsriLeaflet.Tasks.identifyFeatures = function(url, params){
  return new EsriLeaflet.Tasks.IdentifyFeatures(url, params);
};

(function(EsriLeaflet){

  var tileProtocol = (window.location.protocol !== 'https:') ? 'http:' : 'https:';

  EsriLeaflet.Layers.BasemapLayer = L.TileLayer.extend({
    statics: {
      TILES: {
        Streets: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
          attributionUrl: 'https://static.arcgis.com/attribution/World_Street_Map',
          options: {
            hideLogo: false,
            logoPosition: 'bottomright',
            minZoom: 1,
            maxZoom: 19,
            subdomains: ['server', 'services'],
            attribution: 'Esri'
          }
        },
        Topographic: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
          attributionUrl: 'https://static.arcgis.com/attribution/World_Topo_Map',
          options: {
            hideLogo: false,
            logoPosition: 'bottomright',
            minZoom: 1,
            maxZoom: 19,
            subdomains: ['server', 'services'],
            attribution: 'Esri'
          }
        },
        Oceans: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
          attributionUrl: 'https://static.arcgis.com/attribution/Ocean_Basemap',
          options: {
            hideLogo: false,
            logoPosition: 'bottomright',
            minZoom: 1,
            maxZoom: 16,
            subdomains: ['server', 'services'],
            attribution: 'Esri'
          }
        },
        OceansLabels: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}',
          options: {
            hideLogo: true,
            logoPosition: 'bottomright',
            //pane: 'esri-label',
            minZoom: 1,
            maxZoom: 16,
            subdomains: ['server', 'services']
          }
        },
        NationalGeographic: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
          options: {
            hideLogo: false,
            logoPosition: 'bottomright',
            minZoom: 1,
            maxZoom: 16,
            subdomains: ['server', 'services'],
            attribution: 'Esri'
          }
        },
        DarkGray: {
          urlTemplate: tileProtocol + '//tiles{s}.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Dark_Gray_Base_Beta/MapServer/tile/{z}/{y}/{x}',
          options: {
            hideLogo: false,
            logoPosition: 'bottomright',
            minZoom: 1,
            maxZoom: 10,
            subdomains: ['1', '2'],
            attribution: 'Esri, DeLorme, HERE'
          }
        },
        DarkGrayLabels: {
          urlTemplate: tileProtocol + '//tiles{s}.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Dark_Gray_Reference_Beta/MapServer/tile/{z}/{y}/{x}',
          options: {
            hideLogo: true,
            logoPosition: 'bottomright',
            //pane: 'esri-label',
            minZoom: 1,
            maxZoom: 10,
            subdomains: ['1', '2']
          }
        },
        Gray: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          options: {
            hideLogo: false,
            logoPosition: 'bottomright',
            minZoom: 1,
            maxZoom: 16,
            subdomains: ['server', 'services'],
            attribution: 'Esri, NAVTEQ, DeLorme'
          }
        },
        GrayLabels: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
          options: {
            hideLogo: true,
            logoPosition: 'bottomright',
            //pane: 'esri-label',
            minZoom: 1,
            maxZoom: 16,
            subdomains: ['server', 'services']
          }
        },
        Imagery: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          options: {
            hideLogo: false,
            logoPosition: 'bottomright',
            minZoom: 1,
            maxZoom: 19,
            subdomains: ['server', 'services'],
            attribution: 'Esri, DigitalGlobe, GeoEye, i-cubed, USDA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, and the GIS User Community'
          }
        },
        ImageryLabels: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          options: {
            hideLogo: true,
            logoPosition: 'bottomright',
            //pane: 'esri-label',
            minZoom: 1,
            maxZoom: 19,
            subdomains: ['server', 'services']
          }
        },
        ImageryTransportation: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
          //pane: 'esri-label',
          options: {
            hideLogo: true,
            logoPosition: 'bottomright',
            minZoom: 1,
            maxZoom: 19,
            subdomains: ['server', 'services']
          }
        },
        ShadedRelief: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
          options: {
            hideLogo: false,
            logoPosition: 'bottomright',
            minZoom: 1,
            maxZoom: 13,
            subdomains: ['server', 'services'],
            attribution: 'ESRI, NAVTEQ, DeLorme'
          }
        },
        ShadedReliefLabels: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places_Alternate/MapServer/tile/{z}/{y}/{x}',
          options: {
            hideLogo: true,
            logoPosition: 'bottomright',
            //pane: 'esri-label',
            minZoom: 1,
            maxZoom: 12,
            subdomains: ['server', 'services']
          }
        },
        Terrain: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
          options: {
            hideLogo: false,
            logoPosition: 'bottomright',
            minZoom: 1,
            maxZoom: 13,
            subdomains: ['server', 'services'],
            attribution: 'Esri, USGS, NOAA'
          }
        },
        TerrainLabels: {
          urlTemplate: tileProtocol + '//{s}.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}',
          options: {
            hideLogo: true,
            logoPosition: 'bottomright',
            //pane: 'esri-label',
            minZoom: 1,
            maxZoom: 13,
            subdomains: ['server', 'services']
          }
        }
      }
    },
    initialize: function(key, options){
      var config;

      // set the config variable with the appropriate config object
      if (typeof key === 'object' && key.urlTemplate && key.options){
        config = key;
      } else if(typeof key === 'string' && EsriLeaflet.BasemapLayer.TILES[key]){
        config = EsriLeaflet.BasemapLayer.TILES[key];
      } else {
        throw new Error('L.esri.BasemapLayer: Invalid parameter. Use one of "Streets", "Topographic", "Oceans", "OceansLabels", "NationalGeographic", "Gray", "GrayLabels", "DarkGray", "DarkGrayLabels", "Imagery", "ImageryLabels", "ImageryTransportation", "ShadedRelief", "ShadedReliefLabels", "Terrain" or "TerrainLabels"');
      }

      // merge passed options into the config options
      var tileOptions = L.Util.extend(config.options, options);

      // call the initialize method on L.TileLayer to set everything up
      L.TileLayer.prototype.initialize.call(this, config.urlTemplate, L.Util.setOptions(this, tileOptions));

      // if this basemap requires dynamic attribution set it up
      if(config.attributionUrl){
        this._getAttributionData(config.attributionUrl);
      }
    },
    onAdd: function(map){
      if(!this.options.hideLogo){
        this._logo = new EsriLeaflet.Controls.Logo({
          position: this.options.logoPosition
        }).addTo(map);
      }

      // if(this.options.pane && EsriLeaflet.Support.pointerEvents){
      //   this._initPane();
      // }

      L.TileLayer.prototype.onAdd.call(this, map);

      map.on('moveend', this._updateMapAttribution, this);
    },
    onRemove: function(map){
      if(this._logo){
        map.removeControl(this._logo);
      }

      L.TileLayer.prototype.onRemove.call(this, map);

      map.off('moveend', this._updateMapAttribution, this);
    },
    getAttribution:function(){
      var attribution = '<span class="esri-attributions" style="line-height:14px; vertical-align: -3px; text-overflow:ellipsis; white-space:nowrap; overflow:hidden; display:inline-block;">' + this.options.attribution + '</span>'/* + logo*/;
      return attribution;
    },
    // _initPane: function(){
    //   if(!this._map.getPane(this.options.pane)){
    //     var pane = this._map.createPane(this.options.pane);
    //     pane.style.pointerEvents = 'none';
    //     pane.style.zIndex = 5;
    //   }
    // },
    _getAttributionData: function(url){
      EsriLeaflet.get(url, {}, function(error, attributions){
        this._attributions = [];
        for (var c = 0; c < attributions.contributors.length; c++) {
          var contributor = attributions.contributors[c];
          for (var i = 0; i < contributor.coverageAreas.length; i++) {
            var coverageArea = contributor.coverageAreas[i];
            var southWest = new L.LatLng(coverageArea.bbox[0], coverageArea.bbox[1]);
            var northEast = new L.LatLng(coverageArea.bbox[2], coverageArea.bbox[3]);
            this._attributions.push({
              attribution: contributor.attribution,
              score: coverageArea.score,
              bounds: new L.LatLngBounds(southWest, northEast),
              minZoom: coverageArea.zoomMin,
              maxZoom: coverageArea.zoomMax
            });
          }
        }

        this._attributions.sort(function(a, b){
          return b.score - a.score;
        });

        this._updateMapAttribution();
      }, this);
    },
    _updateMapAttribution: function(){
      if(this._map && this._map.attributionControl && this._attributions){
        var newAttributions = '';
        var bounds = this._map.getBounds();
        var zoom = this._map.getZoom();

        for (var i = 0; i < this._attributions.length; i++) {
          var attribution = this._attributions[i];
          var text = attribution.attribution;
          if(!newAttributions.match(text) && bounds.intersects(attribution.bounds) && zoom >= attribution.minZoom && zoom <= attribution.maxZoom) {
            newAttributions += (', ' + text);
          }
        }
        newAttributions = newAttributions.substr(2);
        var attributionElement = this._map.attributionControl._container.querySelector('.esri-attributions');
        attributionElement.innerHTML = newAttributions;
        attributionElement.style.maxWidth =  (this._map.getSize().x * 0.65) + 'px';
        this.fire('attributionupdated', {
          attribution: newAttributions
        });
      }
    }
  });

  EsriLeaflet.BasemapLayer = EsriLeaflet.Layers.BasemapLayer;

  EsriLeaflet.Layers.basemapLayer = function(key, options){
    return new EsriLeaflet.Layers.BasemapLayer(key, options);
  };

  EsriLeaflet.basemapLayer = function(key, options){
    return new EsriLeaflet.Layers.BasemapLayer(key, options);
  };

})(EsriLeaflet);

EsriLeaflet.Layers.RasterLayer =  L.Class.extend({
  includes: L.Mixin.Events,

  options: {
    opacity: 1,
    position: 'front',
    f: 'image'
  },

  onAdd: function (map) {
    this._map = map;

    this._update = L.Util.limitExecByInterval(this._update, this.options.updateInterval, this);

    if (map.options.crs && map.options.crs.code) {
      var sr = map.options.crs.code.split(':')[1];
      this.options.bboxSR = sr;
      this.options.imageSR = sr;
    }

    map.on('moveend', this._update, this);

    // if we had an image loaded and it matches the
    // current bounds show the image otherwise remove it
    if(this._currentImage && this._currentImage._bounds.equals(this._map.getBounds())){
      map.addLayer(this._currentImage);
    } else if(this._currentImage) {
      this._map.removeLayer(this._currentImage);
      this._currentImage = null;
    }

    this._update();

    if(this._popup){
      this._map.on('click', this._getPopupData, this);
      this._map.on('dblclick', this._resetPopupState, this);
    }
  },

  bindPopup: function(fn, popupOptions){
    this._shouldRenderPopup = false;
    this._lastClick = false;
    this._popup = L.popup(popupOptions);
    this._popupFunction = fn;
    if(this._map){
      this._map.on('click', this._getPopupData, this);
      this._map.on('dblclick', this._resetPopupState, this);
    }
    return this;
  },

  unbindPopup: function(){
    if(this._map){
      this._map.closePopup(this._popup);
      this._map.off('click', this._getPopupData, this);
      this._map.off('dblclick', this._resetPopupState, this);
    }
    this._popup = false;
    return this;
  },

  onRemove: function (map) {
    if (this._currentImage) {
      this._map.removeLayer(this._currentImage);
    }

    if(this._popup){
      this._map.off('click', this._getPopupData, this);
      this._map.off('dblclick', this._resetPopupState, this);
    }

    this._map.off('moveend', this._update, this);
    this._map = null;
  },

  addTo: function(map){
    map.addLayer(this);
    return this;
  },

  removeFrom: function(map){
    map.removeLayer(this);
    return this;
  },

  bringToFront: function(){
    this.options.position = 'front';
    if(this._currentImage){
      this._currentImage.bringToFront();
    }
    return this;
  },

  bringToBack: function(){
    this.options.position = 'back';
    if(this._currentImage){
      this._currentImage.bringToBack();
    }
    return this;
  },

  getAttribution: function () {
    return this.options.attribution;
  },

  getOpacity: function(){
    return this.options.opacity;
  },

  setOpacity: function(opacity){
    this.options.opacity = opacity;
    this._currentImage.setOpacity(opacity);
    return this;
  },

  getTimeRange: function(){
    return [this.options.from, this.options.to];
  },

  setTimeRange: function(from, to){
    this.options.from = from;
    this.options.to = to;
    this._update();
    return this;
  },

  metadata: function(callback, context){
    this._service.metadata(callback, context);
    return this;
  },

  authenticate: function(token){
    this._service.authenticate(token);
    return this;
  },

  _renderImage: function(url, bounds){
    if(this._map){
      // create a new image overlay and add it to the map
      // to start loading the image
      // opacity is 0 while the image is loading
      var image = new L.ImageOverlay(url, bounds, {
        opacity: 0
      }).addTo(this._map);

      // once the image loads
      image.once('load', function(e){
        var newImage = e.target;
        var oldImage = this._currentImage;

        // if the bounds of this image matches the bounds that
        // _renderImage was called with and we have a map
        // hide the old image if there is one and set the opacity
        // of the new image otherwise remove the new image
        if(newImage._bounds.equals(bounds)){
          this._currentImage = newImage;

          if(this.options.position === 'front'){
            this.bringToFront();
          } else {
            this.bringToBack();
          }

          if(this._map && this._currentImage._map){
            this._currentImage.setOpacity(this.options.opacity);
          } else {
            this._currentImage._map.removeLayer(this._currentImage);
          }

          if(oldImage && this._map) {
            this._map.removeLayer(oldImage);
          }

          if(oldImage && oldImage._map){
            oldImage._map.removeLayer(oldImage);
          }
        } else {
          this._map.removeLayer(newImage);
        }

        this.fire('load', {
          bounds: bounds
        });

      }, this);

      this.fire('loading', {
        bounds: bounds
      });
    }
  },

  _update: function () {
    if(!this._map){
      return;
    }

    var zoom = this._map.getZoom();
    var bounds = this._map.getBounds();

    if(this._animatingZoom){
      return;
    }

    if (this._map._panTransition && this._map._panTransition._inProgress) {
      return;
    }

    if (zoom > this.options.maxZoom || zoom < this.options.minZoom) {
      return;
    }
    var params = this._buildExportParams();

    this._requestExport(params, bounds);
  },

  // TODO: refactor these into raster layer
  _renderPopup: function(latlng, error, results, response){
    latlng = L.latLng(latlng);
    if(this._shouldRenderPopup && this._lastClick.equals(latlng)){
      //add the popup to the map where the mouse was clicked at
      var content = this._popupFunction(error, results, response);
      if (content) {
        this._popup.setLatLng(latlng).setContent(content).openOn(this._map);
      }
    }
  },

  _resetPopupState: function(e){
    this._shouldRenderPopup = false;
    this._lastClick = e.latlng;
  },

  // from https://github.com/Leaflet/Leaflet/blob/v0.7.2/src/layer/FeatureGroup.js
  // @TODO remove at Leaflet 0.8
  _propagateEvent: function (e) {
    e = L.extend({
      layer: e.target,
      target: this
    }, e);
    this.fire(e.type, e);
  }
});

EsriLeaflet.Layers.DynamicMapLayer = EsriLeaflet.Layers.RasterLayer.extend({

  options: {
    updateInterval: 150,
    layers: false,
    layerDefs: false,
    timeOptions: false,
    format: 'png24',
    transparent: true
  },

  initialize: function (url, options) {
    this.url = EsriLeaflet.Util.cleanUrl(url);
    this._service = new EsriLeaflet.Services.MapService(this.url, options);
    this._service.on('authenticationrequired requeststart requestend requesterror requestsuccess', this._propagateEvent, this);
    L.Util.setOptions(this, options);
  },

  getLayers: function(){
    return this.options.layers;
  },

  setLayers: function(layers){
    this.options.layers = layers;
    this._update();
    return this;
  },

  getLayerDefs: function(){
    return this.options.layerDefs;
  },

  setLayerDefs: function(layerDefs){
    this.options.layerDefs = layerDefs;
    this._update();
    return this;
  },

  getTimeOptions: function(){
    return this.options.timeOptions;
  },

  setTimeOptions: function(timeOptions){
    this.options.timeOptions = timeOptions;
    this._update();
    return this;
  },

  query: function(){
    return this._service.query();
  },

  identify: function(){
    return this._service.identify();
  },

  find: function(){
    return this._service.find();
  },

  _getPopupData: function(e){
    var callback = L.Util.bind(function(error, featureCollection, response) {
      setTimeout(L.Util.bind(function(){
        this._renderPopup(e.latlng, error, featureCollection, response);
      }, this), 300);
    }, this);

    var identifyRequest = this.identify().on(this._map).at(e.latlng);

    if(this.options.layers){
      identifyRequest.layers('visible:' + this.options.layers.join(','));
    } else {
      identifyRequest.layers('visible');
    }

    identifyRequest.run(callback);

    // set the flags to show the popup
    this._shouldRenderPopup = true;
    this._lastClick = e.latlng;
  },

  _buildExportParams: function () {
    var bounds = this._map.getBounds();
    var size = this._map.getSize();
    var ne = this._map.options.crs.project(bounds._northEast);
    var sw = this._map.options.crs.project(bounds._southWest);

    var params = {
      bbox: [sw.x, sw.y, ne.x, ne.y].join(','),
      size: size.x + ',' + size.y,
      dpi: 96,
      format: this.options.format,
      transparent: this.options.transparent,
      bboxSR: this.options.bboxSR,
      imageSR: this.options.imageSR
    };

    if(this.options.layers){
      params.layers = 'show:' + this.options.layers.join(',');
    }

    if(this.options.layerDefs){
      params.layerDefs = JSON.stringify(this.options.layerDefs);
    }

    if(this.options.timeOptions){
      params.timeOptions = JSON.stringify(this.options.timeOptions);
    }

    if(this.options.from && this.options.to){
      params.time = this.options.from.valueOf() + ',' + this.options.to.valueOf();
    }

    if(this._service.options.token) {
      params.token = this._service.options.token;
    }

    return params;
  },

  _requestExport: function (params, bounds) {
    if(this.options.f === 'json'){
      this._service.get('export', params, function(error, response){
        this._renderImage(response.href, bounds);
      }, this);
    } else {
      params.f = 'image';
      this._renderImage(this.url + 'export' + L.Util.getParamString(params), bounds);
    }
  }
});

EsriLeaflet.DynamicMapLayer = EsriLeaflet.Layers.DynamicMapLayer;

EsriLeaflet.Layers.dynamicMapLayer = function(url, options){
  return new EsriLeaflet.Layers.DynamicMapLayer(url, options);
};

EsriLeaflet.dynamicMapLayer = function(url, options){
  return new EsriLeaflet.Layers.DynamicMapLayer(url, options);
};

EsriLeaflet.Layers.ImageMapLayer = EsriLeaflet.Layers.RasterLayer.extend({

  options: {
    updateInterval: 150,
    format: 'jpgpng'
  },

  query: function(){
    return this._service.query();
  },

  identify: function(){
    return this._service.identify();
  },

  initialize: function (url, options) {
    this.url = EsriLeaflet.Util.cleanUrl(url);
    this._service = new EsriLeaflet.Services.ImageService(this.url, options);
    this._service.on('authenticationrequired requeststart requestend requesterror requestsuccess', this._propagateEvent, this);
    L.Util.setOptions(this, options);
  },

  setPixelType: function (pixelType) {
    this.options.pixelType = pixelType;
    this._update();
    return this;
  },

  getPixelType: function () {
    return this.options.pixelType;
  },

  setBandIds: function (bandIds) {
    if (L.Util.isArray(bandIds)) {
      this.options.bandIds = bandIds.join(',');
    } else {
      this.options.bandIds = bandIds.toString();
    }
    this._update();
    return this;
  },

  getBandIds: function () {
    return this.options.bandIds;
  },

  setNoData: function (noData, noDataInterpretation) {
    if (L.Util.isArray(noData)) {
      this.options.noData = noData.join(',');
    } else {
      this.options.noData = noData.toString();
    }
    if (noDataInterpretation) {
      this.options.noDataInterpretation = noDataInterpretation;
    }
    this._update();
    return this;
  },

  getNoData: function () {
    return this.options.noData;
  },

  getNoDataInterpretation: function () {
    return this.options.noDataInterpretation;
  },

  setRenderingRule: function(renderingRule) {
    this.options.renderingRule = renderingRule;
    this._update();
  },

  getRenderingRule: function() {
    return this.options.renderingRule;
  },

  setMosaicRule: function(mosaicRule) {
    this.options.mosaicRule = mosaicRule;
    this._update();
  },

  getMosaicRule: function() {
    return this.options.mosaicRule;
  },

  _getPopupData: function(e){
    var callback = L.Util.bind(function(error, results, response) {
      setTimeout(L.Util.bind(function(){
        this._renderPopup(e.latlng, error, results, response);
      }, this), 300);
    }, this);

    var identifyRequest = this.identify().at(e.latlng);

    // set mosaic rule for identify task if it is set for layer
    if (this.options.mosaicRule) {
      identifyRequest.setMosaicRule(this.options.mosaicRule);
      // @TODO: force return catalog items too?
    }

    // @TODO: set rendering rule? Not sure,
    // sometimes you want raw pixel values
    // if (this.options.renderingRule) {
    //   identifyRequest.setRenderingRule(this.options.renderingRule);
    // }

    identifyRequest.run(callback);

    // set the flags to show the popup
    this._shouldRenderPopup = true;
    this._lastClick = e.latlng;
  },

  _buildExportParams: function () {
    var bounds = this._map.getBounds();
    var size = this._map.getSize();
    var ne = this._map.options.crs.project(bounds._northEast);
    var sw = this._map.options.crs.project(bounds._southWest);

    var params = {
      bbox: [sw.x, sw.y, ne.x, ne.y].join(','),
      size: size.x + ',' + size.y,
      format: this.options.format,
      bboxSR: this.options.bboxSR,
      imageSR: this.options.imageSR
    };

    if (this.options.from && this.options.to) {
      params.time = this.options.from.valueOf() + ',' + this.options.to.valueOf();
    }

    if (this.options.pixelType) {
      params.pixelType = this.options.pixelType;
    }

    if (this.options.interpolation) {
      params.interpolation = this.options.interpolation;
    }

    if (this.options.compressionQuality) {
      params.compressionQuality = this.options.compressionQuality;
    }

    if (this.options.bandIds) {
      params.bandIds = this.options.bandIds;
    }

    if (this.options.noData) {
      params.noData = this.options.noData;
    }

    if (this.options.noDataInterpretation) {
      params.noDataInterpretation = this.options.noDataInterpretation;
    }

    if (this._service.options.token) {
      params.token = this._service.options.token;
    }

    if(this.options.renderingRule) {
      params.renderingRule = JSON.stringify(this.options.renderingRule);
    }

    if(this.options.mosaicRule) {
      params.mosaicRule = JSON.stringify(this.options.mosaicRule);
    }

    return params;
  },

  _requestExport: function (params, bounds) {
    if (this.options.f === 'json') {
      this._service.get('exportImage', params, function(error, response){
        this._renderImage(response.href, bounds);
      }, this);
    } else {
      params.f = 'image';
      this._renderImage(this.url + 'exportImage' + L.Util.getParamString(params), bounds);
    }
  }
});

EsriLeaflet.ImageMapLayer = EsriLeaflet.Layers.ImageMapLayer;

EsriLeaflet.Layers.imageMapLayer = function (url, options) {
  return new EsriLeaflet.Layers.ImageMapLayer(url, options);
};

EsriLeaflet.imageMapLayer = function (url, options) {
  return new EsriLeaflet.Layers.ImageMapLayer(url, options);
};

EsriLeaflet.Layers.TiledMapLayer = L.TileLayer.extend({
  initialize: function(url, options){
    options = L.Util.setOptions(this, options);

    // set the urls
    this.url = L.esri.Util.cleanUrl(url);
    this.tileUrl = L.esri.Util.cleanUrl(url) + 'tile/{z}/{y}/{x}';
    this._service = new L.esri.Services.MapService(this.url, options);
    this._service.on('authenticationrequired requeststart requestend requesterror requestsuccess', this._propagateEvent, this);

    //if this is looking at the AGO tiles subdomain insert the subdomain placeholder
    if(this.tileUrl.match('://tiles.arcgisonline.com')){
      this.tileUrl = this.tileUrl.replace('://tiles.arcgisonline.com', '://tiles{s}.arcgisonline.com');
      options.subdomains = ['1', '2', '3', '4'];
    }

    if(this.options.token) {
      this.tileUrl += ('?token=' + this.options.token);
    }

    // init layer by calling TileLayers initialize method
    L.TileLayer.prototype.initialize.call(this, this.tileUrl, options);
  },

  metadata: function(callback, context){
    this._service.metadata(callback, context);
    return this;
  },

  identify: function(){
    return this._service.identify();
  },

  authenticate: function(token){
    var tokenQs = '?token=' + token;
    this.tileUrl = (this.options.token) ? this.tileUrl.replace(/\?token=(.+)/g, tokenQs) : this.tileUrl + tokenQs;
    this.options.token = token;
    this._service.authenticate(token);
    return this;
  },

  // from https://github.com/Leaflet/Leaflet/blob/v0.7.2/src/layer/FeatureGroup.js
  // @TODO remove at Leaflet 0.8
  _propagateEvent: function (e) {
    e = L.extend({
      layer: e.target,
      target: this
    }, e);
    this.fire(e.type, e);
  }
});

L.esri.TiledMapLayer = L.esri.Layers.tiledMapLayer;

L.esri.Layers.tiledMapLayer = function(url, options){
  return new L.esri.Layers.TiledMapLayer(url, options);
};

L.esri.tiledMapLayer = function(url, options){
  return new L.esri.Layers.TiledMapLayer(url, options);
};

EsriLeaflet.Layers.FeatureGrid = L.Class.extend({

  includes: L.Mixin.Events,

  options: {
    cellSize: 512,
    updateInterval: 150
  },

  initialize: function (options) {
    options = L.setOptions(this, options);
  },

  onAdd: function (map) {
    this._map = map;
    this._update = L.Util.limitExecByInterval(this._update, this.options.updateInterval, this);

    // @TODO remove for leaflet 0.8
    this._map.addEventListener(this.getEvents(), this);

    this._reset();
    this._update();
  },

  onRemove: function(){
    this._map.removeEventListener(this.getEvents(), this);
    this._removeCells();
  },

  getEvents: function () {
    var events = {
      viewreset: this._reset,
      moveend: this._update
    };

    return events;
  },

  addTo: function(map){
    map.addLayer(this);
    return this;
  },

  removeFrom: function(map){
    map.removeLayer(this);
    return this;
  },

  _reset: function () {
    this._removeCells();

    this._cells = {};
    this._activeCells = {};
    this._cellsToLoad = 0;
    this._cellsTotal = 0;

    // @TODO enable at Leaflet 0.8
    // this._cellNumBounds = this._getCellNumBounds();

    this._resetWrap();
  },

  _resetWrap: function () {
    var map = this._map,
        crs = map.options.crs;

    if (crs.infinite) { return; }

    var cellSize = this._getCellSize();

    if (crs.wrapLng) {
      this._wrapLng = [
        Math.floor(map.project([0, crs.wrapLng[0]]).x / cellSize),
        Math.ceil(map.project([0, crs.wrapLng[1]]).x / cellSize)
      ];
    }

    if (crs.wrapLat) {
      this._wrapLat = [
        Math.floor(map.project([crs.wrapLat[0], 0]).y / cellSize),
        Math.ceil(map.project([crs.wrapLat[1], 0]).y / cellSize)
      ];
    }
  },

  _getCellSize: function () {
    return this.options.cellSize;
  },

  _update: function () {
    if (!this._map) { return; }

    var bounds = this._map.getPixelBounds(),
        zoom = this._map.getZoom(),
        cellSize = this._getCellSize();

    if (zoom > this.options.maxZoom ||
        zoom < this.options.minZoom) { return; }

    // cell coordinates range for the current view
    var cellBounds = L.bounds(
      bounds.min.divideBy(cellSize).floor(),
      bounds.max.divideBy(cellSize).floor());

    this._addCells(cellBounds);
    this._removeOtherCells(cellBounds);
  },

  _addCells: function (bounds) {
    var queue = [],
        center = bounds.getCenter(),
        zoom = this._map.getZoom();

    var j, i, coords;
    // create a queue of coordinates to load cells from
    for (j = bounds.min.y; j <= bounds.max.y; j++) {
      for (i = bounds.min.x; i <= bounds.max.x; i++) {
        coords = new L.Point(i, j);
        coords.z = zoom;

        // @TODO enable at Leaflet 0.8
        // if (this._isValidCell(coords)) {
        //   queue.push(coords);
        // }

        queue.push(coords);
      }
    }
    var cellsToLoad = queue.length;

    if (cellsToLoad === 0) { return; }

    this._cellsToLoad += cellsToLoad;
    this._cellsTotal += cellsToLoad;

    // sort cell queue to load cells in order of their distance to center
    queue.sort(function (a, b) {
      return a.distanceTo(center) - b.distanceTo(center);
    });

    for (i = 0; i < cellsToLoad; i++) {
      this._addCell(queue[i]);
    }
  },

  // @TODO enable at Leaflet 0.8
  // _isValidCell: function (coords) {
  //   var crs = this._map.options.crs;

  //   if (!crs.infinite) {
  //     // don't load cell if it's out of bounds and not wrapped
  //     var bounds = this._cellNumBounds;
  //     if (
  //       (!crs.wrapLng && (coords.x < bounds.min.x || coords.x > bounds.max.x)) ||
  //       (!crs.wrapLat && (coords.y < bounds.min.y || coords.y > bounds.max.y))
  //     ) {
  //       return false;
  //     }
  //   }

  //   if (!this.options.bounds) {
  //     return true;
  //   }

  //   // don't load cell if it doesn't intersect the bounds in options
  //   var cellBounds = this._cellCoordsToBounds(coords);
  //   return L.latLngBounds(this.options.bounds).intersects(cellBounds);
  // },

  // converts cell coordinates to its geographical bounds
  _cellCoordsToBounds: function (coords) {
    var map = this._map,
        cellSize = this.options.cellSize,

        nwPoint = coords.multiplyBy(cellSize),
        sePoint = nwPoint.add([cellSize, cellSize]),

        // @TODO for Leaflet 0.8
        // nw = map.wrapLatLng(map.unproject(nwPoint, coords.z)),
        // se = map.wrapLatLng(map.unproject(sePoint, coords.z));

        nw = map.unproject(nwPoint, coords.z).wrap(),
        se = map.unproject(sePoint, coords.z).wrap();

    return new L.LatLngBounds(nw, se);
  },

  // converts cell coordinates to key for the cell cache
  _cellCoordsToKey: function (coords) {
    return coords.x + ':' + coords.y;
  },

  // converts cell cache key to coordiantes
  _keyToCellCoords: function (key) {
    var kArr = key.split(':'),
        x = parseInt(kArr[0], 10),
        y = parseInt(kArr[1], 10);

    return new L.Point(x, y);
  },

  // remove any present cells that are off the specified bounds
  _removeOtherCells: function (bounds) {
    for (var key in this._cells) {
      if (!bounds.contains(this._keyToCellCoords(key))) {
        this._removeCell(key);
      }
    }
  },

  _removeCell: function (key) {
    var cell = this._activeCells[key];
    if(cell){
      delete this._activeCells[key];

      if (this.cellLeave) {
        this.cellLeave(cell.bounds, cell.coords);
      }

      this.fire('cellleave', {
        bounds: cell.bounds,
        coords: cell.coords
      });
    }
  },

  _removeCells: function(){
    for (var key in this._cells) {
      var bounds = this._cells[key].bounds;
      var coords = this._cells[key].coords;

      if (this.cellLeave) {
        this.cellLeave(bounds, coords);
      }

      this.fire('cellleave', {
        bounds: bounds,
        coords: coords
      });
    }
  },

  _addCell: function (coords) {

    // wrap cell coords if necessary (depending on CRS)
    this._wrapCoords(coords);

    // generate the cell key
    var key = this._cellCoordsToKey(coords);

    // get the cell from the cache
    var cell = this._cells[key];
    // if this cell should be shown as isnt active yet (enter)

    if (cell && !this._activeCells[key]) {
      if (this.cellEnter) {
        this.cellEnter(cell.bounds, coords);
      }

      this.fire('cellenter', {
        bounds: cell.bounds,
        coords: coords
      });

      this._activeCells[key] = cell;
    }

    // if we dont have this cell in the cache yet (create)
    if (!cell) {
      cell = {
        coords: coords,
        bounds: this._cellCoordsToBounds(coords)
      };

      this._cells[key] = cell;
      this._activeCells[key] = cell;

      if(this.createCell){
        this.createCell(cell.bounds, coords);
      }

      this.fire('cellcreate', {
        bounds: cell.bounds,
        coords: coords
      });
    }
  },

  _wrapCoords: function (coords) {
    coords.x = this._wrapLng ? L.Util.wrapNum(coords.x, this._wrapLng) : coords.x;
    coords.y = this._wrapLat ? L.Util.wrapNum(coords.y, this._wrapLat) : coords.y;
  }

  // get the global cell coordinates range for the current zoom
  // @TODO enable at Leaflet 0.8
  // _getCellNumBounds: function () {
  //   // @TODO for Leaflet 0.8
  //   // var bounds = this._map.getPixelWorldBounds(),
  //   //     size = this._getCellSize();
  //   //
  //   // return bounds ? L.bounds(
  //   //     bounds.min.divideBy(size).floor(),
  //   //     bounds.max.divideBy(size).ceil().subtract([1, 1])) : null;
  // }

});

(function(EsriLeaflet){

  EsriLeaflet.Layers.FeatureManager = EsriLeaflet.Layers.FeatureGrid.extend({

    /**
     * Options
     */

    options: {
      where: '1=1',
      fields: ['*'],
      from: false,
      to: false,
      timeField: false,
      timeFilterMode: 'server',
      simplifyFactor: 0,
      precision: 6
    },

    /**
     * Constructor
     */

    initialize: function (url, options) {
      EsriLeaflet.Layers.FeatureGrid.prototype.initialize.call(this, options);

      options = L.setOptions(this, options);

      this.url = EsriLeaflet.Util.cleanUrl(url);

      this._service = new EsriLeaflet.Services.FeatureLayer(this.url, options);

      //use case insensitive regex to look for common fieldnames used for indexing
      /*global console */
      if (this.options.fields[0] !== '*'){
        var oidCheck = false;
        for (var i = 0; i < this.options.fields.length; i++){
          if (this.options.fields[i].match(/^(OBJECTID|FID|OID|ID)$/i)){
            oidCheck = true;
          }
        }
        if (oidCheck === false && console && console.warn){
          console.warn('no known esriFieldTypeOID field detected in fields Array.  Please add an attribute field containing unique IDs to ensure the layer can be drawn correctly.');
        }
      }

      // Leaflet 0.8 change to new propagation
      this._service.on('authenticationrequired requeststart requestend requesterror requestsuccess', function (e) {
        e = L.extend({
          target: this
        }, e);
        this.fire(e.type, e);
      }, this);

      if(this.options.timeField.start && this.options.timeField.end){
        this._startTimeIndex = new BinarySearchIndex();
        this._endTimeIndex = new BinarySearchIndex();
      } else if(this.options.timeField){
        this._timeIndex = new BinarySearchIndex();
      }

      this._currentSnapshot = []; // cache of what layers should be active
      this._activeRequests = 0;
      this._pendingRequests = [];
    },

    /**
     * Layer Interface
     */

    onAdd: function(map){
      return EsriLeaflet.Layers.FeatureGrid.prototype.onAdd.call(this, map);
    },

    onRemove: function(map){
      return EsriLeaflet.Layers.FeatureGrid.prototype.onRemove.call(this, map);
    },

    getAttribution: function () {
      return this.options.attribution;
    },

    /**
     * Feature Managment
     */

    createCell: function(bounds, coords){
      this._requestFeatures(bounds, coords);
    },

    _requestFeatures: function(bounds, coords, callback){
      this._activeRequests++;

      // our first active request fires loading
      if(this._activeRequests === 1){
        this.fire('loading', {
          bounds: bounds
        });
      }

      return this._buildQuery(bounds).run(function(error, featureCollection, response){
        if(response && response.exceededTransferLimit){
          this.fire('drawlimitexceeded');
        }

        //deincriment the request counter
        this._activeRequests--;

        if(!error && featureCollection.features.length){
          this._addFeatures(featureCollection.features, coords);
        }

        if(callback){
          callback.call(this, error, featureCollection);
        }

        // if there are no more active requests fire a load event for this view
        if(this._activeRequests <= 0){
          this.fire('load', {
            bounds: bounds
          });
        }
      }, this);
    },

    _addFeatures: function(features){
      for (var i = features.length - 1; i >= 0; i--) {
        var id = features[i].id;
        this._currentSnapshot.push(id);
      }

      if(this.options.timeField){
        this._buildTimeIndexes(features);
      }

      this.createLayers(features);
    },

    _buildQuery: function(bounds){
      var query = this._service.query().intersects(bounds).where(this.options.where).fields(this.options.fields).precision(this.options.precision);

      if(this.options.simplifyFactor){
        query.simplify(this._map, this.options.simplifyFactor);
      }

      if(this.options.timeFilterMode === 'server' && this.options.from && this.options.to){
        query.between(this.options.from, this.options.to);
      }

      return query;
    },

    /**
     * Where Methods
     */

    setWhere: function(where, callback, context){

      this.options.where = (where && where.length) ? where : '1=1';

      var oldSnapshot = [];
      var newShapshot = [];
      var pendingRequests = 0;
      var requestError = null;
      var requestCallback = L.Util.bind(function(error, featureCollection){
        if(error){
          requestError = error;
        }

        if(featureCollection){
          for (var i = featureCollection.features.length - 1; i >= 0; i--) {
            newShapshot.push(featureCollection.features[i].id);
          }
        }

        pendingRequests--;

        if(pendingRequests <= 0){
          this._currentSnapshot = newShapshot;
          this.removeLayers(oldSnapshot);
          this.addLayers(newShapshot);
          if(callback) {
            callback.call(context, requestError);
          }
        }
      }, this);

      for (var i = this._currentSnapshot.length - 1; i >= 0; i--) {
        oldSnapshot.push(this._currentSnapshot[i]);
      }

      for(var key in this._activeCells){
        pendingRequests++;
        var coords = this._keyToCellCoords(key);
        var bounds = this._cellCoordsToBounds(coords);
        this._requestFeatures(bounds, key, requestCallback);
      }

      return this;
    },

    getWhere: function(){
      return this.options.where;
    },

    /**
     * Time Range Methods
     */

    getTimeRange: function(){
      return [this.options.from, this.options.to];
    },

    setTimeRange: function(from, to, callback, context){
      var oldFrom = this.options.from;
      var oldTo = this.options.to;
      var pendingRequests = 0;
      var requestError = null;
      var requestCallback = L.Util.bind(function(error){
        if(error){
          requestError = error;
        }
        this._filterExistingFeatures(oldFrom, oldTo, from, to);

        pendingRequests--;

        if(callback && pendingRequests <= 0){
          callback.call(context, requestError);
        }
      }, this);

      this.options.from = from;
      this.options.to = to;

      this._filterExistingFeatures(oldFrom, oldTo, from, to);

      if(this.options.timeFilterMode === 'server') {
        for(var key in this._activeCells){
          pendingRequests++;
          var coords = this._keyToCellCoords(key);
          var bounds = this._cellCoordsToBounds(coords);
          this._requestFeatures(bounds, key, requestCallback);
        }
      }
    },

    refresh: function(){
      for(var key in this._activeCells){
        var coords = this._keyToCellCoords(key);
        var bounds = this._cellCoordsToBounds(coords);
        this._requestFeatures(bounds, key);
      }
    },

    _filterExistingFeatures: function (oldFrom, oldTo, newFrom, newTo) {
      var layersToRemove = (oldFrom && oldTo) ? this._getFeaturesInTimeRange(oldFrom, oldTo) : this._currentSnapshot;
      var layersToAdd = this._getFeaturesInTimeRange(newFrom, newTo);

      if(layersToAdd.indexOf){
        for (var i = 0; i < layersToAdd.length; i++) {
          var shouldRemoveLayer = layersToRemove.indexOf(layersToAdd[i]);
          if(shouldRemoveLayer >= 0){
            layersToRemove.splice(shouldRemoveLayer, 1);
          }
        }
      }

      this.removeLayers(layersToRemove);
      this.addLayers(layersToAdd);
    },

    _getFeaturesInTimeRange: function(start, end){
      var ids = [];
      var search;

      if(this.options.timeField.start && this.options.timeField.end){
        var startTimes = this._startTimeIndex.between(start, end);
        var endTimes = this._endTimeIndex.between(start, end);
        search = startTimes.concat(endTimes);
      } else {
        search = this._timeIndex.between(start, end);
      }

      for (var i = search.length - 1; i >= 0; i--) {
        ids.push(search[i].id);
      }

      return ids;
    },

    _buildTimeIndexes: function(geojson){
      var i;
      var feature;
      if(this.options.timeField.start && this.options.timeField.end){
        var startTimeEntries = [];
        var endTimeEntries = [];
        for (i = geojson.length - 1; i >= 0; i--) {
          feature = geojson[i];
          startTimeEntries.push( {
            id: feature.id,
            value: new Date(feature.properties[this.options.timeField.start])
          });
          endTimeEntries.push( {
            id: feature.id,
            value: new Date(feature.properties[this.options.timeField.end])
          });
        }
        this._startTimeIndex.bulkAdd(startTimeEntries);
        this._endTimeIndex.bulkAdd(endTimeEntries);
      } else {
        var timeEntries = [];
        for (i = geojson.length - 1; i >= 0; i--) {
          feature = geojson[i];
          timeEntries.push( {
            id: feature.id,
            value: new Date(feature.properties[this.options.timeField])
          });
        }

        this._timeIndex.bulkAdd(timeEntries);
      }
    },

    _featureWithinTimeRange: function(feature){
      if(!this.options.from || !this.options.to){
        return true;
      }

      var from = +this.options.from.valueOf();
      var to = +this.options.to.valueOf();

      if(typeof this.options.timeField === 'string'){
        var date = +feature.properties[this.options.timeField];
        return (date >= from) && (date <= to);
      }

      if(this.options.timeField.start &&  this.options.timeField.end){
        var startDate = +feature.properties[this.options.timeField.start];
        var endDate = +feature.properties[this.options.timeField.end];
        return ((startDate >= from) && (startDate <= to)) || ((endDate >= from) && (endDate <= to));
      }
    },

    /**
     * Service Methods
     */

    authenticate: function(token){
      this._service.authenticate(token);
      return this;
    },

    metadata: function(callback, context){
      this._service.metadata(callback, context);
      return this;
    },

    query: function(){
      return this._service.query();
    },

    addFeature: function(feature, callback, context){
      this._service.addFeature(feature, function(error, response){
        if(!error){
          this.refresh();
        }
        if(callback){
          callback.call(context, error, response);
        }
      }, this);
      return this;
    },

    updateFeature: function(feature, callback, context){
      return this._service.updateFeature(feature, function(error, response){
        if(!error){
          this.refresh();
        }
        if(callback){
          callback.call(context, error, response);
        }
      }, this);
    },

    deleteFeature: function(id, callback, context){
      return this._service.deleteFeature(id, function(error, response){
        if(!error && response.objectId){
          this.removeLayers([response.objectId], true);
        }
        if(callback){
          callback.call(context, error, response);
        }
      }, this);
    }
  });

  /**
   * Temporal Binary Search Index
   */

  function BinarySearchIndex(values) {
    this.values = values || [];
  }

  BinarySearchIndex.prototype._query = function(query){
    var minIndex = 0;
    var maxIndex = this.values.length - 1;
    var currentIndex;
    var currentElement;
    var resultIndex;

    while (minIndex <= maxIndex) {
      resultIndex = currentIndex = (minIndex + maxIndex) / 2 | 0;
      currentElement = this.values[Math.round(currentIndex)];
      if (+currentElement.value < +query) {
        minIndex = currentIndex + 1;
      } else if (+currentElement.value > +query) {
        maxIndex = currentIndex - 1;
      } else {
        return currentIndex;
      }
    }

    return ~maxIndex;
  };

  BinarySearchIndex.prototype.sort = function(){
    this.values.sort(function(a, b) {
      return +b.value - +a.value;
    }).reverse();
    this.dirty = false;
  };

  BinarySearchIndex.prototype.between = function(start, end){
    if(this.dirty){
      this.sort();
    }

    var startIndex = this._query(start);
    var endIndex = this._query(end);

    if(startIndex === 0 && endIndex === 0){
      return [];
    }

    startIndex = Math.abs(startIndex);
    endIndex = (endIndex < 0) ? Math.abs(endIndex): endIndex + 1;

    return this.values.slice(startIndex, endIndex);
  };

  BinarySearchIndex.prototype.bulkAdd = function(items){
    this.dirty = true;
    this.values = this.values.concat(items);
  };

})(EsriLeaflet);

EsriLeaflet.Layers.FeatureLayer = EsriLeaflet.Layers.FeatureManager.extend({

  statics: {
    EVENTS: 'click dblclick mouseover mouseout mousemove contextmenu popupopen popupclose'
  },

  /**
   * Constructor
   */

  initialize: function (url, options) {
    EsriLeaflet.Layers.FeatureManager.prototype.initialize.call(this, url, options);

    options = L.setOptions(this, options);

    this._layers = {};
    this._leafletIds = {};
    this._key = 'c'+(Math.random() * 1e9).toString(36).replace('.', '_');
  },

  /**
   * Layer Interface
   */

  onAdd: function(map){
    return EsriLeaflet.Layers.FeatureManager.prototype.onAdd.call(this, map);
  },

  onRemove: function(map){

    for (var i in this._layers) {
      map.removeLayer(this._layers[i]);
    }

    return EsriLeaflet.Layers.FeatureManager.prototype.onRemove.call(this, map);
  },

  createNewLayer: function(geojson){
    // @TODO Leaflet 0.8
    //newLayer = L.GeoJSON.geometryToLayer(geojson, this.options);
    return L.GeoJSON.geometryToLayer(geojson, this.options.pointToLayer, L.GeoJSON.coordsToLatLng, this.options);
  },

  /**
   * Feature Managment Methods
   */

  createLayers: function(features){
    for (var i = features.length - 1; i >= 0; i--) {

      var geojson = features[i];

      var layer = this._layers[geojson.id];
      var newLayer;

      if(layer && !this._map.hasLayer(layer)){
        this._map.addLayer(layer);
      }

      if (layer && layer.setLatLngs) {
        // @TODO Leaflet 0.8
        //newLayer = L.GeoJSON.geometryToLayer(geojson, this.options);

        var updateGeo = this.createNewLayer(geojson);
        layer.setLatLngs(updateGeo.getLatLngs());
      }

      if(!layer){
        // @TODO Leaflet 0.8
        //newLayer = L.GeoJSON.geometryToLayer(geojson, this.options);

        newLayer =  this.createNewLayer(geojson);
        newLayer.feature = geojson;
        newLayer.defaultOptions = newLayer.options;
        newLayer._leaflet_id = this._key + '_' + geojson.id;

        this._leafletIds[newLayer._leaflet_id] = geojson.id;

        // bubble events from layers to this
        // @TODO Leaflet 0.8
        // newLayer.addEventParent(this);

        newLayer.on(EsriLeaflet.Layers.FeatureLayer.EVENTS, this._propagateEvent, this);

        // bind a popup if we have one
        if(this._popup && newLayer.bindPopup){
          newLayer.bindPopup(this._popup(newLayer.feature, newLayer), this._popupOptions);
        }

        if(this.options.onEachFeature){
          this.options.onEachFeature(newLayer.feature, newLayer);
        }

        // cache the layer
        this._layers[newLayer.feature.id] = newLayer;

        // style the layer
        this.resetStyle(newLayer.feature.id);

        this.fire('createfeature', {
          feature: newLayer.feature
        });

        // add the layer if it is within the time bounds or our layer is not time enabled
        if(!this.options.timeField || (this.options.timeField && this._featureWithinTimeRange(geojson)) ){
          this._map.addLayer(newLayer);
        }
      }
    }
  },

  addLayers: function(ids){
    for (var i = ids.length - 1; i >= 0; i--) {
      var layer = this._layers[ids[i]];
      if(layer){
        this.fire('addfeature', {
          feature: layer.feature
        });
        this._map.addLayer(layer);
      }
    }
  },

  removeLayers: function(ids, permanent){
    for (var i = ids.length - 1; i >= 0; i--) {
      var id = ids[i];
      var layer = this._layers[id];
      if(layer){
        this.fire('removefeature', {
          feature: layer.feature,
          permanent: permanent
        });
        this._map.removeLayer(layer);
      }
      if(layer && permanent){
        delete this._layers[id];
      }
    }
  },

  /**
   * Styling Methods
   */

  resetStyle: function (id) {
    var layer = this._layers[id];

    if(layer){
      layer.options = layer.defaultOptions;
      this.setFeatureStyle(layer.feature.id, this.options.style);
    }

    return this;
  },

  setStyle: function (style) {
    this.options.style = style;
    this.eachFeature(function (layer) {
      this.setFeatureStyle(layer.feature.id, style);
    }, this);
    return this;
  },

  setFeatureStyle: function (id, style) {
    var layer = this._layers[id];

    if (typeof style === 'function') {
      style = style(layer.feature);
    }

    /*trap inability to access default style options from MultiLine/MultiPolygon
    please revisit at Leaflet 1.0*/
    else if (!style && !layer.defaultOptions) {
      var dummyPath = new L.Path();
      style = L.Path.prototype.options;
    }

    if (layer.setStyle) {
      layer.setStyle(style);
    }
  },

  /**
   * Popup Methods
   */

  bindPopup: function (fn, options) {
    this._popup = fn;
    this._popupOptions = options;
    for (var i in this._layers) {
      var layer = this._layers[i];
      var popupContent = this._popup(layer.feature, layer);
      layer.bindPopup(popupContent, options);
    }
    return this;
  },

  unbindPopup: function () {
    this._popup =  false;
    for (var i in this._layers) {
      var layer = this._layers[i];
      if (layer.unbindPopup) {
        layer.unbindPopup();
      } else if (layer.getLayers) {
        var groupLayers = layer.getLayers();
        for (var j in groupLayers) {
          var gLayer = groupLayers[j];
          gLayer.unbindPopup();
        }
      }
    }
    return this;
  },

  /**
   * Utility Methods
   */

  eachFeature: function (fn, context) {
    for (var i in this._layers) {
      fn.call(context, this._layers[i]);
    }
    return this;
  },

  getFeature: function (id) {
    return this._layers[id];
  },

  // from https://github.com/Leaflet/Leaflet/blob/v0.7.2/src/layer/FeatureGroup.js
  // @TODO remove at Leaflet 0.8
  _propagateEvent: function (e) {
    e.layer = this._layers[this._leafletIds[e.target._leaflet_id]];
    e.target = this;
    this.fire(e.type, e);
  }
});

EsriLeaflet.FeatureLayer = EsriLeaflet.Layers.FeatureLayer;

EsriLeaflet.Layers.featureLayer = function(url, options){
  return new EsriLeaflet.Layers.FeatureLayer(url, options);
};

EsriLeaflet.featureLayer = function(url, options){
  return new EsriLeaflet.Layers.FeatureLayer(url, options);
};


EsriLeaflet.Controls.Logo = L.Control.extend({
  options: {
    position: 'bottomright',
    marginTop: 0,
    marginLeft: 0,
    marginBottom: 0,
    marginRight: 0
  },
  onAdd: function () {
    var div = L.DomUtil.create('div', 'esri-leaflet-logo');
    div.style.marginTop = this.options.marginTop;
    div.style.marginLeft = this.options.marginLeft;
    div.style.marginBottom = this.options.marginBottom;
    div.style.marginRight = this.options.marginRight;
    div.innerHTML = '<a href="https://developers.arcgis.com" style="border: none;"><img src="https://js.arcgis.com/3.10/js/esri/images/map/logo-med.png" style="border: none;"></a>';
    return div;
  }
});

EsriLeaflet.Controls.logo = function(options){
  return new L.esri.Controls.Logo(options);
};


  return EsriLeaflet;
}));
//# sourceMappingURL=esri-leaflet-src.js.map