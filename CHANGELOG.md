# v2.0.1 (18-08-2016)

## Bug fixes

- **Unsubscribe** - Fix subscription not being removed correctly on unsubscribe.

# v2.0.0 (01-04-2016)

## Breaking changes

- **mqtt.js dependency**: MQTT over Websockets using _mqtt.js_ instead of 
[_Eclipse Paho MQTTWS_](http://git.eclipse.org/c/paho/org.eclipse.paho.mqtt.javascript.git/tree/src/mqttws31.js), 
for maintainability and consistency with MQTT plugin.

## Migrating from v1.x

- If using AMD (RequireJS) to load evrythng.js, the configuration of the dependencies changed from:

```javascript
requirejs.config({
    paths: {
        'bower-mqttws': '../bower_components/bower-mqttws/mqttws31',
        'evrythng': '../bower_components/evrythng/dist/evrythng',
        'evrythng-ws': '../bower_components/evrythng-ws/dist/evrythng-ws'
    },
    shim: {
      'bower-mqttws': {
        'exports': 'Paho'
      },
      'evrythng': ['bower-mqttws']
    }
});
```

To:

```javascript
requirejs.config({
    paths: {
        'mqtt': '../bower_components/mqttjs-browserified/dist/mqtt',
        'evrythng': '../bower_components/evrythng/dist/evrythng',
        'evrythng-ws': '../bower_components/evrythng-ws/dist/evrythng-ws'
    }
});
```

# v1.0.3 (14-12-2015)

## Changes

- **keepAliveInterval**: renamed setting to keepAlive for consistency with MQTT plugin. 
Old setting still accepted with deprecation warning.

## Bug fixes

- **Persistent reconnect** - Once connection is lost, keep trying to connect every
*EVT.WS.settings.reconnectPeriod* milliseconds.
- **Multiple subscriptions** - Fix incorrect handling of multiple subscriptions.

# v1.0.2 (02-12-2015)

## Bug fixes

- **Resubscribe on reconnect** - Restore subscriptions after reconnect.
- **One connection per scope** - When making multiple subscriptions in parallel, only 
one connection per scope should be created.

# v1.0.1 (09-10-2015)

## Bug fixes

- **Dependencies** - Updated evrythng.js version dependency.

# v1.0.0 (30-07-2015)

## Features

- **WebSockets methods**: allow to *subscribe*, *unsubscribe* and *publish* to any EVT resource.
