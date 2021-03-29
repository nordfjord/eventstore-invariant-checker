import {
  ANY,
  AppendResult,
  BACKWARDS,
  END,
  EventStoreDBClient,
  ExpectedRevision,
  FORWARDS,
  jsonEvent,
  JSONEventData,
  JSONEventType,
  JSONRecordedEvent,
  NO_STREAM,
  START,
  WrongExpectedVersionError,
} from '@eventstore/db-client'
import * as uuid from 'uuid'
import { Readable } from 'stream'
import { AsyncIterableX, from } from 'ix/asynciterable'
import { filter, map } from 'ix/asynciterable/operators'

export function createEventStore(client: EventStoreDBClient) {
  async function storeCheckpoint(name: string, checkpoint: bigint) {
    await client.appendToStream(
      `__checkpoint-${name}`,
      [
        jsonEvent({
          type: '__checkpoint',
          data: { checkpoint: checkpoint.toString(10) },
          id: uuid.v4(),
        }),
      ],
      { expectedRevision: ANY }
    )
  }

  async function getCheckpoint(name: string) {
    try {
      const events = await client.readStream<CheckpointEvent>(
        `__checkpoint-${name}`,
        {
          fromRevision: END,
          direction: BACKWARDS,
          maxCount: 1,
        }
      )

      if (events.length && typeof events[0].event?.data.checkpoint === 'string')
        return BigInt(events[0].event.data.checkpoint)

      return -1n
    } catch (e) {
      return -1n
    }
  }

  async function loadEvents<T extends JSONEventType = JSONEventType>(
    streamName: string
  ): Promise<JSONRecordedEvent<T>[]> {
    try {
      const events = await client.readStream<T>(streamName, {
        direction: FORWARDS,
        fromRevision: START,
      })

      return events
        .filter((x) => x.event != null)
        .map((x) => x.event!) as JSONRecordedEvent<T>[]
    } catch (e) {
      return []
    }
  }

  async function appendEvents(
    streamName: string,
    expectedVersion: ExpectedRevision,
    events: JSONEventData[]
  ) {
    return client.appendToStream(streamName, events, {
      expectedRevision: expectedVersion === -1n ? NO_STREAM : expectedVersion,
    })
  }

  function subscribeToStream<
    KnownEventType extends JSONEventType = JSONEventType
  >(
    streamName: string,
    checkpoint: bigint
  ): AsyncIterableX<JSONRecordedEvent<KnownEventType>> {
    return from(
      client.subscribeToStream<KnownEventType>(streamName, {
        fromRevision: checkpoint === -1n ? START : checkpoint,
      })
    ).pipe(
      filter((resolved) => !!resolved.event),
      map((resolved) => resolved.event! as JSONRecordedEvent<KnownEventType>)
    )
  }

  return {
    loadEvents,
    appendEvents,
    getCheckpoint,
    storeCheckpoint,
    subscribeToStream,
  }
}

export function createInMemoryStore(): IEventStore {
  const checkpoints: Record<string, bigint> = {}
  const streams: Record<string, JSONEventData[]> = {}
  const allEvents: JSONEventData[] = []
  const subscriptions: Record<string, Readable[]> = {}

  function getAllSubscriptions(streamId: string, type: string) {
    return (subscriptions[streamId] || [])
      .concat(subscriptions[`$et-${type}`] || [])
      .concat(subscriptions[`$ce-${streamId.split('-')[0]}`] || [])
      .concat(subscriptions['$all'] || [])
  }

  async function runSubscriptions(streamId: string, events: JSONEventData[]) {
    for (const event of events) {
      for (const sub of getAllSubscriptions(streamId, event.type)) {
        const resolvedEvent: JSONRecordedEvent<JSONEventData> = {
          ...event,
          streamId,
          isJson: true,
          revision: BigInt(streams[streamId].indexOf(event)),
          created: Date.now(),
        }
        await sub.push(resolvedEvent)
      }
    }
  }

  async function appendEvents(
    streamName: string,
    expectedVersion: ExpectedRevision,
    events: JSONEventData[]
  ): Promise<AppendResult> {
    if (expectedVersion == NO_STREAM && streams[streamName])
      throw new WrongExpectedVersionError()
    const stream = streams[streamName] || (streams[streamName] = [])
    if (
      typeof expectedVersion === 'bigint' &&
      Number(expectedVersion) !== stream.length - 1
    )
      throw new WrongExpectedVersionError()

    stream.push(...events)
    allEvents.push(...events)

    await runSubscriptions(streamName, events)

    return {
      success: true,
      position: {
        commit: BigInt(allEvents.length),
        prepare: BigInt(allEvents.length),
      },
      nextExpectedRevision: BigInt(stream.length - 1),
    }
  }

  async function getCheckpoint(name: string): Promise<bigint> {
    return Promise.resolve(checkpoints[name] ?? -1n)
  }

  async function loadEvents<T extends JSONEventType>(
    streamName: string
  ): Promise<JSONRecordedEvent<T>[]> {
    return Promise.resolve(
      (streams[streamName] || []).map(
        (event, revision) =>
          ({
            ...event,
            isJson: true,
            streamId: streamName,
            revision: BigInt(revision),
            created: 0,
          } as any)
      )
    )
  }

  async function storeCheckpoint(
    name: string,
    newCheckpoint: bigint
  ): Promise<void> {
    checkpoints[name] = newCheckpoint
    return Promise.resolve(undefined)
  }

  function subscribeToStream<
    KnownEventType extends JSONEventType = JSONEventType
  >(streamName: string): AsyncIterableX<JSONRecordedEvent<KnownEventType>> {
    const stream = new Readable({
      objectMode: true,
      read() {},
    })
    ;(subscriptions[streamName] || (subscriptions[streamName] = [])).push(
      stream
    )
    return from(stream)
  }

  return {
    appendEvents,
    loadEvents,
    storeCheckpoint,
    getCheckpoint,
    subscribeToStream,
  }
}

export type IEventStore = ReturnType<typeof createEventStore>
export type CheckpointEvent = JSONEventType<
  'InvariantCheckerCheckpoint',
  { checkpoint: string }
>

export interface EventMetadata {
  $correlationId: string
  $causationId: string
}
