# Event Store Invariant Checker

This project enables generic invariant checking via two phase commit in event store

## Usage

Run the container such that it can access your event store. Then you can write `__InvariantCheckRequested` events to
the `__async_invariant` stream.

### InvariantCheckRequested

example

```ts
import { EventStoreDBClient, jsonEvent, NO_STREAM } from '@eventstore/db-client'

const userId = uuid()
const eventId = uuid()
const invariantCheckRequested = {
  type: '__InvariantCheckRequested',
  id: eventId,
  data: {
    invariant: {
      category: 'UserEmailReservation',
      value: 'me@example.com',
      type: 'unique',
      entityId: userId,
    },
    resultingEvent: {
      streamId: `User-${userId}`,
      type: 'UserRegistered',
      id: uuid(),
      expectedRevision: NO_STREAM,
      data: {
        userId,
        email: 'me@example.com',
        name: 'Me Me',
      },
    },
  },
  metadata: {
    $correlationId: eventId,
    $causationId: eventId,
  },
}

await client.appendToStream(
  `__async_invariant`,
  jsonEvent(invariantCheckRequested),
  {
    expectedRevision: ANY,
  }
)
```


# How to use

### 1. Build the docker image

```sh
$ docker build -t invariant-checker:local .
```
### 2. Run the docker image

```sh
$ docker run --rm -it \
  -e ESDB_CONN_STRING="esdb://connectionstring" \
  --name invariant-checker \
  invariant-checker:local
```

### 3. Start sending events!
