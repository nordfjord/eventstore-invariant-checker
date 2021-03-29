import {
  ExpectedRevision,
  jsonEvent,
  JSONEventType,
  JSONRecordedEvent,
} from '@eventstore/db-client'
import { EventMetadata, IEventStore } from './infrastructure/event-store'
import * as uuid from 'uuid'
import { Reservations } from './reservations'
import { filter } from 'ix/asynciterable/operators'

export function createInvariants(
  store: IEventStore,
  reservations: Reservations
) {
  async function handleInvariantCheckRequested(
    event: JSONRecordedEvent<InvariantCheckRequested>
  ) {
    const data = event.data
    if (!data.invariant) return
    if (data.invariant.type !== 'unique') {
      throw new Error('Not Implemented Exception')
    }

    const reservationStatus = await reservations.reserve(
      `${data.invariant.category}-${data.invariant.value}`,
      data.invariant.entityId,
      {
        // @ts-ignore
        $correlationId: event.metadata?.$correlationId ?? event.id,
        $causationId: event.id,
      }
    )

    if (!reservationStatus.success) {
      throw new InvariantFailedException(reservationStatus.error)
    }

    // We have the reservation
    const resultingEvent = data.resultingEvent
    const resultingEventId = resultingEvent.id ?? uuid.v4()
    await store.appendEvents(
      data.resultingEvent.streamId,
      data.resultingEvent.expectedRevision,
      [
        jsonEvent({
          id: resultingEventId,
          type: data.resultingEvent.type,
          data: data.resultingEvent.data,
          metadata: {
            // @ts-ignore
            $correlationId: event.metadata?.$correlationId ?? event.id,
            $causationId: event.id,
            ...(data.resultingEvent.metadata || {}),
          },
        }),
      ]
    )
  }

  async function subscribe(signal?: AbortSignal) {
    const checkpoint = await store.getCheckpoint('InvariantChecker')

    const subscription = store.subscribeToStream<InvariantCheckRequested>(
      `__async_invariant`,
      checkpoint
    )

    console.log('subscribed to stream')

    await subscription
      .pipe(filter((x) => x.type === '__InvariantCheckRequested'))
      .forEach(
        async (event) => {
          try {
            await handleInvariantCheckRequested(event)
            console.log(
              'Invariant check succeeded',
              event.data.invariant.category
            )
          } catch (e) {
            if (!(e instanceof InvariantFailedException)) throw e
            console.log('Invariant check failed', e)
          }
          await store.storeCheckpoint('InvariantChecker', event.revision)
        },
        null,
        signal
      )
  }

  return { subscribe, handleInvariantCheckRequested }
}

export type Invariants = ReturnType<typeof createInvariants>

export class InvariantFailedException extends Error {
  constructor(error: Error) {
    super(error.message)
    this.stack = error.stack
  }
}

export type InvariantCheckRequested = JSONEventType<
  '__InvariantCheckRequested',
  {
    invariant: Invariant
    resultingEvent: {
      streamId: string
      type: string
      id?: string
      expectedRevision: ExpectedRevision
      data: any
      metadata?: any
    }
  },
  EventMetadata
>

export interface Invariant {
  category: string
  value: string
  entityId: string
  type: 'unique'
}
