import { EventStoreDBClient } from '@eventstore/db-client'
import { createEventStore, IEventStore } from './infrastructure/event-store'
import { createReservations } from './reservations'
import { createInvariants, InvariantCheckRequested } from './invariants'

export async function main() {
  const client = EventStoreDBClient.connectionString(
    process.env.ESDB_CONN_STRING ||
      'esdb://admin:changeit@127.0.0.1:2113?tls=false'
  )

  const store = createEventStore(client)
  const reservations = createReservations(store)
  const invariants = createInvariants(store, reservations)

  const abortController = new AbortController()
  process.once('SIGINT', () => abortController.abort())

  return invariants.subscribe(abortController.signal)
}

void main()
