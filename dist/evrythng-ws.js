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
    define(['mqtt'], factory);

  } else {

    // Browser globals
    root.EVT.WS = root.Evrythng.WS = factory(root.mqtt);

  }

}(this, function (mqtt) {
  'use strict';

  var version = '2.0.2';


  // Setup default settings:

  // - _**apiUrl**: EVRYTHNG URL for the WS server_
  // - _**reconnectPeriod**: Connection retry timeout_
  // - _**keepAlive**: Longest period of time which broker and client can
  // live without sending a message_
  // - _**clientIdPrefix**: Prefix in randomly generated unique ID_
  var defaultSettings = {
    apiUrl: 'wss://ws.evrythng.com:443/mqtt',
    reconnectPeriod: 1000,
    keepAlive: 50,
    clientIdPrefix: 'evtjs'
  };

  var connectPromiseMap = {},
    subscribeMap = {};

  // Generate unique client ID for WS connection.
  function _generateClientId(prefix) {
    return prefix + '_' + Math.random().toString(16).substr(2, 8);
  }

  // Check if client exists and is connected
  function _isClientConnected(scope) {
    return scope.wsClient && scope.wsClient.connected === true;
  }

  // Get an existent or create a new WS client for the specified scope.
  function _getClient(scope) {

    if (connectPromiseMap[scope.apiKey]) {
      return connectPromiseMap[scope.apiKey];
    }

    connectPromiseMap[scope.apiKey] = new Promise(function (resolve, reject) {

      // Reset connection promise.
      // If there was no previous client, reject and
      // terminate the pending connection to prevent
      // infinite reconnections.
      function _cleanUp(error) {
        delete connectPromiseMap[scope.apiKey];

        if (!scope.wsClient) {
          client.end();
          reject(error);
        }
      }

      function _initClient() {

        // Restore subscriptions on reconnect.
        if (subscribeMap[scope.apiKey]) {
          Object.keys(subscribeMap[scope.apiKey]).forEach(function (path) {
            client.subscribe(path);
          });
        }

        // One client per scope.
        scope.wsClient = client;
        resolve(scope.wsClient);
      }

      if (_isClientConnected(scope)) {

        // Return existing client if exists and is connected.
        resolve(scope.mqttClient);

      } else {

        // Create a new MQTT WS client.
        var settings = EVTWsPlugin.settings,
          mqttOptions = {
            username: 'authorization',
            password: scope.apiKey,
            clientId: _generateClientId(settings.clientIdPrefix),
            keepalive: settings.keepAlive,
            reconnectPeriod: settings.reconnectPeriod
          },
          client = mqtt.connect(settings.apiUrl, mqttOptions);

        client.on('connect', _initClient);

        // Failed to connect because could not reach host
        // or connection explicitly closed on the server end.
        client.on('close', _cleanUp);

        // Failed to connect because server did not
        // accept the connection (e.g. authorization).
        client.on('error', _cleanUp);

        // One message handler per client.
        client.on('message', function (path, message) {
          _onMessage(scope.apiKey, path, message);
        });
      }

    });

    return connectPromiseMap[scope.apiKey];
  }


  // Publish a message on this resource's path topic.
  function _publishMessage(message, successCallback, errorCallback) {
    var $this = this;

    return _getClient(this.scope).then(function (client) {
      return new Promise(function (resolve, reject) {

        function publishHandler(err) {
          if (err) {

            // Failed to publish.
            if (errorCallback) {
              errorCallback(err);
            }

            reject(err);

          } else {

            if (successCallback) {
              successCallback();
            }
            resolve();
          }
        }

        // Data has to be sent as a string
        message = JSON.stringify($this.jsonify(message));

        client.publish($this.path, message, publishHandler);
      });
    }).catch(function (err) {
      if (errorCallback) {
        errorCallback(err);
      }

      return Promise.reject(err);
    });
  }

  function _addSubscription(scope, path, onMessage) {
    if (!subscribeMap[scope.apiKey]) {
      subscribeMap[scope.apiKey] = {};
    }

    if (!subscribeMap[scope.apiKey][path]) {
      subscribeMap[scope.apiKey][path] = [];
    }

    subscribeMap[scope.apiKey][path].push(onMessage);
  }

  function _removeSubscription(scope, path) {
    delete subscribeMap[scope.apiKey][path];
  }

  function _onMessage(apiKey, path, message) {
    if (subscribeMap[apiKey][path]) {
      subscribeMap[apiKey][path].forEach(function (onMessage) {
        onMessage(message);
      });
    }
  }


  // Plugin API
  var EVTWsPlugin = {

    version: version,

    settings: defaultSettings,

    // Setup new settings.
    setup: function (customSettings) {
      if (Object.prototype.toString.call(customSettings) === '[object Object]') {

        // Override default settings with new ones
        for (var i in customSettings) {
          if (customSettings.hasOwnProperty(i)) {

            // TODO deprecate
            if (i === 'keepAliveInterval') {
              console.warn('[EvrythngJS WS] keepAliveInterval option has been deprecated. Use keepAlive instead.');
              this.settings.keepAlive = customSettings[i];
              continue;
            }

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

        return _getClient($this.scope).then(function (client) {
          return new Promise(function (resolve, reject) {

            function subscriptionHandler(err) {
              if (err) {

                // Failed to subscribe.
                if (errorCallback) {
                  errorCallback(err);
                }

                reject(err);

              } else {

                // Store all subscriptions.
                _addSubscription($this.scope, $this.path, function (message) {

                  // Incoming as Buffer.
                  var response = message.toString();

                  // Try to parse as JSON and then to the corresponding resource class.
                  try {
                    response = $this.parse(JSON.parse(response));
                  } catch (e) {}

                  messageCallback(response);
                });

                if (successCallback) {
                  successCallback(client);
                }

                resolve(client);
              }
            }

            client.subscribe($this.path, subscriptionHandler);
          });
        }).catch(function (err) {

          if (errorCallback) {
            errorCallback(err);
          }

          return Promise.reject(err);
        });
      }


      // Unsubscribe from this resource's path topic.
      function unsubscribe(successCallback, errorCallback) {
        var $this = this;

        return new Promise(function (resolve, reject) {

          if (!_isClientConnected($this.scope)) {
            var connectErr = new Error('WS Client is not connected.');

            if (errorCallback) {
              errorCallback(connectErr);
            }

            return reject(connectErr);
          }

          function unsubscriptionHandler(err) {
            if (err) {

              // Failed to unsubscribe
              if (errorCallback) {
                errorCallback(err);
              }
              reject(err);

            } else {

              // Remove subscription from the history.
              _removeSubscription($this.scope, $this.path);

              if (successCallback) {
                successCallback($this.scope.wsClient);
              }
              resolve($this.scope.wsClient);
            }
          }

          $this.scope.wsClient.unsubscribe($this.path, unsubscriptionHandler);
        });
      }


      // Convert an Update/Create request into a MQTT publish message.
      function publish(message, successCallback, errorCallback) {
        var $this = this;

        if (typeof message === 'undefined') {
          message = {};
        }

        // Action is special, as it publishes on POST
        var method = this.class === Action['class'] ? 'create' : 'update';

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
          }).catch(function (err) {

            // If promise was reject without being cancelled bubble up.
            if (!err.cancelled) {
              throw err;
            }

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
