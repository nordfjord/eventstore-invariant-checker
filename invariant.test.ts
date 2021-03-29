import 'abortcontroller-polyfill/dist/abortcontroller-polyfill-only'
import * as uuid from 'uuid'
import {
  createEventStore,
  createInMemoryStore,
} from './src/infrastructure/event-store'
import { createReservations } from './src/reservations'
import { createInvariants, InvariantCheckRequested } from './src/invariants'
import { ANY, jsonEvent, NO_STREAM } from '@eventstore/db-client'

let abortController: AbortController
beforeEach(() => {
  abortController = new AbortController()
})

afterEach(() => {
  abortController.abort()
})

function createWorld() {
  const store = createInMemoryStore()
  const reservations = createReservations(store)
  const invariants = createInvariants(store, reservations)

  return { store, reservations, invariants }
}

test('It allows writing of user registered events', async () => {
  const { store, invariants } = createWorld()
  void invariants.subscribe(abortController.signal)
  await new Promise((res) => process.nextTick(res))

  const userId = uuid.v4()
  const handlers = createHandlers(store)

  await handlers.registerUser({
    email: 'joe@aol.com',
    name: 'Joe',
    id: userId,
  })

  await new Promise((res) => setTimeout(res, 100))
  await expect(store.loadEvents(`User-${userId}`)).resolves.toEqual([
    expect.objectContaining({
      data: {
        userId,
        email: 'joe@aol.com',
        name: 'Joe',
      },
      id: expect.any(String),
    }),
  ])
})

test("It blocks when invariant doesn't hold", async () => {
  const { store, invariants } = createWorld()
  void invariants.subscribe(abortController.signal)
  await new Promise((res) => process.nextTick(res))
  const userId = uuid.v4()
  const secondUserId = uuid.v4()
  const handlers = createHandlers(store)

  await handlers.registerUser({
    id: userId,
    email: 'joe@aol.com',
    name: 'Joe',
  })
  await handlers.registerUser({
    id: secondUserId,
    email: 'joe@aol.com',
    name: 'Joe',
  })

  await new Promise((res) => setTimeout(res, 100))
  await expect(store.loadEvents(`User-${userId}`)).resolves.toEqual([
    expect.objectContaining({
      data: {
        userId,
        email: 'joe@aol.com',
        name: 'Joe',
      },
      id: expect.any(String),
    }),
  ])

  await expect(store.loadEvents(`User-${secondUserId}`)).resolves.toEqual([])
})

test('It only allows one event through under high concurrency', async () => {
  const { store, invariants } = createWorld()
  void invariants.subscribe(abortController.signal)
  await new Promise((res) => process.nextTick(res))
  const handlers = createHandlers(store)

  const users = Array.from({ length: 100 }).map((_, i) => ({
    id: uuid.v4(),
    email: 'joe@aol.com',
    name: 'Joe ' + i,
  }))

  await Promise.all(users.map(handlers.registerUser))

  await new Promise((res) => setTimeout(res, 100))

  const streams = await Promise.all(
    users.map((user) => store.loadEvents(`User-${user.id}`))
  )

  expect(streams.length).toBe(100)

  expect(streams.flatMap((x) => x)).toHaveLength(1)
})

// @ts-ignore
BigInt.prototype.toJSON = function () {
  return this.toString(10)
}

function createHandlers(store: ReturnType<typeof createEventStore>) {
  async function registerUser({ email, id, name }: User) {
    await store.appendEvents(`__async_invariant`, ANY, [
      jsonEvent<InvariantCheckRequested>({
        type: '__InvariantCheckRequested',
        id: uuid.v4(),
        data: {
          invariant: {
            category: 'UserEmailReservation',
            value: 'joe@aol.com',
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
      }),
    ])
  }

  return { registerUser }
}

interface User {
  email: string
  name: string
  id: string
}
