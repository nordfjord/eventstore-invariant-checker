import {
  ANY,
  EventStoreDBClient,
  jsonEvent,
  NO_STREAM,
} from '@eventstore/db-client'
import { createEventStore } from './src/infrastructure/event-store'
import { InvariantCheckRequested } from './src/invariants'
import * as uuid from 'uuid'

const client = EventStoreDBClient.connectionString(
  process.env.ESDB_CONN_STRING ||
    'esdb://admin:changeit@127.0.0.1:2113?tls=false'
)

const store = createEventStore(client)

void registerUser({ email: 'joel@example.com', id: uuid.v4(), name: 'Joel' })
async function registerUser({ email, id, name }: User) {
  const eventId = uuid.v4()
  await store.appendEvents(`__async_invariant`, ANY, [
    jsonEvent<InvariantCheckRequested>({
      type: '__InvariantCheckRequested',
      id: eventId,
      data: {
        invariant: {
          category: 'UserEmailReservation',
          value: email,
          type: 'unique',
          entityId: id,
        },
        resultingEvent: {
          streamId: `User-${id}`,
          type: 'UserRegistered',
          metadata: {},
          id: uuid.v4(),
          data: {
            userId: id,
            email,
            name,
          },
          expectedRevision: NO_STREAM,
        },
      },
      metadata: {
        $correlationId: eventId,
        $causationId: eventId,
      },
    }),
  ])
}

interface User {
  email: string
  name: string
  id: string
}
