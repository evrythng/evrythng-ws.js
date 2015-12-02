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
    define(['bower-mqttws'], factory);

  } else {

    // Browser globals
    root.EVT.WS = root.Evrythng.WS = factory(root.Paho);

  }

}(this, function (Paho) {
  'use strict';

  var version = '1.0.2';


  // Setup default settings:

  // - _**apiUrl**: EVRYTHNG URL for the WS server_
  // - ***reconnectPeriod**: Connection retry timeout*
  // - _**keepAliveInterval**: Longest period of time which broker and client can
  // live without sending a message_
  // - _**clientIdPrefix**: Prefix in randomly generated unique ID_
  var defaultSettings = {
    apiUrl: 'wss://ws.evrythng.com:443/mqtt',
    reconnectPeriod: 1000,
    keepAliveInterval: 50,
    clientIdPrefix: 'evtjs'
  };

  var connectPromiseMap = {},
    subscribeMap = {};

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

    if (connectPromiseMap[scope.apiKey]) {
      return connectPromiseMap[scope.apiKey];
    }

    connectPromiseMap[scope.apiKey] = new Promise (function (resolve, reject) {
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
            client.onConnectionLost = function () {

              // Wait 1 second before reconnecting, to avoid
              // hammering the server with connection requests...
              setTimeout(function () {
                Object.keys(subscribeMap[scope.apiKey]).forEach(function (path) {

                  // Re-subscribe to the topics we were subscribed to.
                  subscribeMap[scope.apiKey][path]();
                });
              }, settings.reconnectPeriod);

              delete connectPromiseMap[scope.apiKey];
            };

            scope.wsClient = client;
            resolve(scope.wsClient);
          },
          onFailure: function (error) {
            console.error('Unable to connect to WS server: ' +
              host + ', please check and try again');

            delete connectPromiseMap[scope.apiKey];
            reject(error);
          }
        });
      }
    });

    return connectPromiseMap[scope.apiKey];
  }


  // Publish a message on this resource's path WS topic.
  function _publishMessage(message, successCallback) {
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

  function _addSubscription(scope, path, subscription) {
    if (!subscribeMap[scope.apiKey]) {
      subscribeMap[scope.apiKey] = {};
    }

    if (!subscribeMap[scope.apiKey][path]) {
      subscribeMap[scope.apiKey][path] = subscription;
    }
  }

  function _removeSubscription(scope, path) {
    if (subscribeMap[scope.apiKey]) {
      delete subscribeMap[scope.apiKey][path];
    }
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
      connectPromiseMap = {};

      // Subscribe to the current resource path topic. Create client if needed.
      // Message callback is called all the time a new message is received on that topic.
      function subscribe(messageCallback, successCallback, errorCallback) {
        if (Object.prototype.toString.call(messageCallback) != '[object Function]') {
          throw new TypeError('Message callback missing.');
        }

        var $this = this;

        return _getClient($this.scope).then(function (client) {
          return new Promise (function (resolve, reject) {
            client.subscribe($this.path, {
              onSuccess: function () {

                // Store all the subscriptions.
                _addSubscription($this.scope, $this.path, subscribe.bind($this, messageCallback));

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
            var connectErr = new Error('MQTT Client is not connected.');

            if (errorCallback) {
              errorCallback(connectErr);
            }

            reject('WS Client is not connected.');
          } else {
            $this.scope.wsClient.unsubscribe($this.path, {
              onSuccess: function () {

                // Remove subscription from the history.
                _removeSubscription($this.scope, $this.path);

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
          }).catch(function () {});
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
