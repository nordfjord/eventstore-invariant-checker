import { ANY, EventStoreDBClient, jsonEvent } from '@eventstore/db-client'
import * as uuid from 'uuid'

export function handleEvent() {
}

export function main() {
  const client = EventStoreDBClient.connectionString(process.env.ESDB_CONN_STRING || 'esdb://admin:changeit@127.0.0.1:2113')

  client.subscribeToStream(`$et-$InvariantCheckRequested`, {})
}

async function storeCheckpoint(client: EventStoreDBClient, checkpoint: bigint) {
  client.appendToStream(`InvariantCheckerCheckpoint`, [jsonEvent({
    type: '$checkpoint',
    data: { checkpoint },
    id: uuid.v4()
  })], { expectedRevision: ANY })
}