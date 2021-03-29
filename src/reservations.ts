import { jsonEvent, JSONEventType } from '@eventstore/db-client'
import { EventMetadata, IEventStore } from './infrastructure/event-store'
import * as uuid from 'uuid'

export type Reserved = JSONEventType<'Reserved', { reservedBy: string }>
export type Unreserved = JSONEventType<'Unreserved', { reservedBy: string }>

export function reservedReducer(
  state: string | null,
  event: Reserved | Unreserved
) {
  if (state === event.data.reservedBy && event.type === 'Unreserved')
    return null
  if (state == null && event.type === 'Reserved') return event.data.reservedBy
  return state
}

export function createReservations(store: IEventStore) {
  async function getCurrentReservationHolder(
    streamId: string
  ): Promise<{ currentHolder: string | null; revision: bigint }> {
    const events = await store.loadEvents<Reserved | Unreserved>(streamId)
    return {
      currentHolder: events.reduce(reservedReducer, null),
      revision: BigInt(events.length - 1),
    }
  }

  async function reserve(
    streamId: string,
    reservedBy: string,
    metadata: EventMetadata
  ): Promise<
    { success: false; error: ReservationException } | { success: true }
  > {
    const { currentHolder, revision } = await getCurrentReservationHolder(
      streamId
    )
    if (currentHolder != null && currentHolder !== reservedBy) {
      return {
        success: false,
        error: new ReservationException(
          `Failed to reserve ${streamId}. current holder is: ${currentHolder}. Tried to reserve for: ${reservedBy}`
        ),
      }
    }

    const eventId = uuid.v4()

    await store.appendEvents(streamId, revision, [
      jsonEvent<Reserved>({
        type: 'Reserved',
        id: eventId,
        data: {
          reservedBy,
        },
        metadata,
      }),
    ])

    return { success: true }
  }

  return { reserve }
}

export type Reservations = ReturnType<typeof createReservations>

export class ReservationException extends Error {}
