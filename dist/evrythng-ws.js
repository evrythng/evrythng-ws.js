// ## EVRYTHNG-WS.JS Plugin

// This is an evrythng.js plugin that adds WebSockets support to Resources.
// This means that, after installed, the application is able to
// subscribe, unsubscribe and publish messages to any resource:

// ```
//  // Subscribe to actions on a particular thng
//  user.thng('{id}').action('all').subscribe(function(action){
//    console.log('New action:', action);
//  });
//
//  // Subscribe to property updates on a particular product
//  user.product('{id}').property().subscribe(function(properties){
//    console.log('Property changes:', properties);
//  });
//
//  // Publish new message via WebSockets
//  user.product('{id}').property('foo').publish('my new value!');
// ```

(function (root, factory) {
  'use strict';

  if (typeof define === 'function' && define.amd) {

    // AMD.
    define(['mqttws'], factory);

  } else {

    // Browser globals
    root.EVT.WS = root.Evrythng.WS = factory(root.Paho);

  }

}(this, function (Paho) {
  'use strict';

  var version = '1.0.0';


  // Setup default settings:

  // - _**apiUrl**: EVRYTHNG URL for the WS server_
  // - _**keepAliveInterval**: Longest period of time which broker and client can
  // live without sending a message_
  // - _**clientIdPrefix**: Prefix in randomly generated unique ID_
  var defaultSettings = {
    apiUrl: 'wss://ws.evrythng.com:443/mqtt',
    keepAliveInterval: 60,
    clientIdPrefix: 'evtjs'
  };

  // Generate unique client ID for WS connection.
  function _generateClientId(prefix) {
    return prefix + '_' + Math.random().toString(16).substr(2, 8);
  }

  function _isClientConnected(scope) {
    return scope.wsClient instanceof Paho.MQTT.Client && scope.wsClient.isConnected();
  }

  // Get an existent or create a new WS client for the specified scope.
  function _getClient(scope) {
    var settings = EVTWsPlugin.settings;

    return new Promise (function (resolve, reject) {
      if (_isClientConnected(scope)) {

        // Return existing client if exists and is connected.
        resolve(scope.wsClient);
      } else {

        // Create a new client and store in scope.
        var client = null,
          host = settings.apiUrl,
          wsClientId = _generateClientId(settings.clientIdPrefix);

        client = new Paho.MQTT.Client(host, wsClientId);

        client.connect({
          userName: 'authorization',
          password: scope.apiKey,
          keepAliveInterval: settings.keepAliveInterval,
          onSuccess: function () {
            scope.wsClient = client;
            resolve(scope.wsClient);
          },
          onFailure: function (error) {
            console.error('Unable to connect to WS server: ' +
              host + ', please check and try again');
            reject(error);
          }
        });
      }
    });
  }


  // Publish a message on this resource's path WS topic.
  function _publishMessage(message, successCallback, errorCallback) {
    var $this = this;

    return _getClient(this.scope).then(function (client) {
      return new Promise(function (resolve, reject) {

        if (!_isClientConnected($this.scope)) {
          reject('WS Client is not connected.');
        }

        // Data has to be sent as a string
        message = JSON.stringify($this.jsonify(message));

        message = new Paho.MQTT.Message(message);
        message.destinationName = $this.path;

        client.onMessageDelivered = function () {
          if (successCallback) {
            successCallback();
          }
          resolve();
        };

        client.send(message);
      });
    });
  }

  var EVTWsPlugin = {
    version: version,

    settings: defaultSettings,

    // Setup new settings.
    setup: function (customSettings) {
      if (Object.prototype.toString.call(customSettings) === '[object Object]') {

        // Override default settings with new ones
        for (var i in customSettings) {
          if (customSettings.hasOwnProperty(i)) {
            this.settings[i] = customSettings[i];
          }
        }

      } else {
        throw new TypeError('Setup should be called with an options object.');
      }

      return this.settings;
    },

    install: function (Resource, Action) {

      // Subscribe to the current resource path topic. Create client if needed.
      // Message callback is called all the time a new message is received on that topic.
      function subscribe(messageCallback, successCallback, errorCallback) {
        if (Object.prototype.toString.call(messageCallback) != '[object Function]') {
          throw new TypeError('Message callback missing.');
        }

        var $this = this;

        return _getClient(this.scope).then(function (client) {
          return new Promise (function (resolve, reject) {
            client.subscribe($this.path, {
              onSuccess: function () {
                client.onMessageArrived = function (msg) {
                  var response = msg.payloadString;

                  // Try to parse as JSON and then to the corresponding resource class.
                  try {
                    response = $this.parse(JSON.parse(response));
                  } catch (e) {
                  }

                  messageCallback(response);
                };

                if (successCallback) {
                  successCallback(client);
                }

                resolve(client);
              },
              onFailure: function(err) {
                console.error('Unable to subscribe to the topic: ' +
                  $this.path + ', please check and try again.');

                if (errorCallback) {
                  errorCallback(err);
                }

                reject(err);
              }
            });
          });
        });
      }

      // Unsubscribe from this resource's path WS topic.
      function unsubscribe (successCallback, errorCallback) {
        var $this = this;

        return new Promise (function (resolve, reject) {
          if (!_isClientConnected($this.scope)) {
            reject('WS Client is not connected.');
          } else {
            $this.scope.wsClient.unsubscribe($this.path, {
              onSuccess: function () {
                if (successCallback) {
                  successCallback();
                }

                resolve($this.scope.wsClient);
              },
              onFailure: function (err) {
                console.error('Unable to unsubscribe to ' + $this.path);

                if (errorCallback) {
                  errorCallback(err);
                }

                reject(err);
              }
            });
          }
        });
      }

      // Convert an Update/Create request into a MQTT publish message.
      function publish (message, successCallback, errorCallback) {
        var $this = this;

        if(typeof message === 'undefined'){
          message = {};
        }

        // Action is special, as it publishes on POST
        var  method = this.class === Action['class'] ? 'create' : 'update';

        return new Promise(function (resolve, reject) {

          var transferToPublish = {
            request: function (options, cancel) {
              // Cancel REST request
              cancel();

              // Use normalized data as the message to publish
              _publishMessage.call($this, options.data, successCallback, errorCallback).then(resolve, reject);
            }
          };

          $this[method](message, {
            interceptors: [transferToPublish]
          });
        });
      }

      // Add WS methods to any Resource
      Resource.prototype.subscribe = subscribe;
      Resource.prototype.unsubscribe = unsubscribe;
      Resource.prototype.publish = publish;
    }
  };

  // Modules that this plugin requires. Injected into the install method.
  EVTWsPlugin.$inject = ['resource', 'entity/action'];

  return EVTWsPlugin;
}));
