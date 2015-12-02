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
