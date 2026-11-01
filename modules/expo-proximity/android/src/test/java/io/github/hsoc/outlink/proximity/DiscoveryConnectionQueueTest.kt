package io.github.hsoc.outlink.proximity

import org.junit.Assert.assertEquals
import org.junit.Test

class DiscoveryConnectionQueueTest {
  private val tasks = mutableListOf<Runnable>()
  private val delays = mutableListOf<Long>()
  private val cancelled = mutableListOf<Runnable>()
  private val connected = mutableListOf<String>()
  private val queue = DiscoveryConnectionQueue(
    schedule = { task, delay -> tasks.add(task); delays.add(delay) },
    cancel = { cancelled.add(it) },
    maximumPending = 2,
  ).also { it.startScan() }

  @Test
  fun repeatedAdvertisementsDoNotRestartTheGracePeriod() {
    repeat(20) { queue.enqueue("peer", 3_000) { connected.add("peer") } }
    assertEquals(1, tasks.size)
    assertEquals(emptyList<String>(), connected)
    tasks.single().run()
    assertEquals(listOf("peer"), connected)
  }

  @Test
  fun incomingConnectionGetsTimeToFinishMailboxDiscovery() {
    queue.enqueue("peer", 3_000) { connected.add("peer") }
    queue.defer("peer", 10_000)
    tasks.first().run()
    assertEquals(emptyList<String>(), connected)
    assertEquals(listOf(3_000L, 10_000L), delays)
    assertEquals(1, cancelled.size)
    tasks.last().run()
    assertEquals(listOf("peer"), connected)
  }

  @Test
  fun stalledIncomingDiscoveryStillFallsBack() {
    queue.enqueue("peer", 3_000) { connected.add("peer") }
    queue.defer("peer", 10_000)
    tasks.last().run()
    assertEquals(listOf("peer"), connected)
  }

  @Test
  fun stoppedSessionCannotConnectIntoTheNextSession() {
    queue.enqueue("peer", 3_000) { connected.add("old") }
    queue.stopSession()
    queue.startScan()
    queue.enqueue("peer", 3_000) { connected.add("new") }
    tasks.first().run()
    assertEquals(emptyList<String>(), connected)
    tasks.last().run()
    assertEquals(listOf("new"), connected)
  }

  @Test
  fun timedScanEndPreservesStalledIncomingFallback() {
    queue.enqueue("peer", 3_000) { connected.add("peer") }
    queue.defer("peer", 10_000)
    // The radio scan expires before the deferred connection's deadline.
    queue.stopScan()
    queue.enqueue("late-advertisement", 3_000) { connected.add("late") }
    assertEquals(2, tasks.size)
    tasks.first().run()
    assertEquals(emptyList<String>(), connected)
    tasks.last().run()
    assertEquals(listOf("peer"), connected)
  }

  @Test
  fun incomingDiscoveryCanDeferAfterTheRadioStops() {
    queue.enqueue("peer", 3_000) { connected.add("peer") }
    queue.stopScan()
    queue.defer("peer", 10_000)
    tasks.first().run()
    assertEquals(emptyList<String>(), connected)
    tasks.last().run()
    assertEquals(listOf("peer"), connected)
  }

  @Test
  fun sessionStopCancelsFallbackAfterTheScanHasAlreadyEnded() {
    queue.enqueue("peer", 3_000) { connected.add("peer") }
    queue.defer("peer", 10_000)
    queue.stopScan()
    queue.stopSession()
    tasks.forEach { it.run() }
    assertEquals(emptyList<String>(), connected)
  }

  @Test
  fun suppressionCancelsPendingDiscovery() {
    queue.enqueue("peer", 3_000) { connected.add("peer") }
    queue.remove("peer")
    tasks.single().run()
    assertEquals(emptyList<String>(), connected)
  }

  @Test
  fun pendingConnectionsAreBoundedAndReleaseCapacity() {
    queue.enqueue("one", 3_000) { connected.add("one") }
    queue.enqueue("two", 3_000) { connected.add("two") }
    queue.enqueue("three", 3_000) { connected.add("three") }
    assertEquals(2, tasks.size)
    tasks.first().run()
    queue.enqueue("three", 3_000) { connected.add("three") }
    assertEquals(3, tasks.size)
  }
}
