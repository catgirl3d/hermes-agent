import asyncio
import json
import threading
import time

from hermes_cli import mcp_startup
from tui_gateway import server
from tui_gateway import ws as ws_mod


def test_ws_startup_starts_background_mcp_discovery(monkeypatch):
    """The desktop app and dashboard chat reach the agent through this WS
    sidecar, not through tui_gateway.entry.main() (which spawns the discovery
    thread for the stdio TUI). handle_ws must start discovery itself, otherwise
    _make_agent's wait_for_mcp_discovery no-ops and the agent snapshots an
    MCP-less tool list. Regression test for #38945."""
    calls = []
    monkeypatch.setattr(
        mcp_startup,
        "start_background_mcp_discovery",
        lambda **kw: calls.append(kw),
    )

    class FakeWS:
        async def accept(self):
            pass

        async def send_text(self, line):
            pass

        async def receive_text(self):
            raise ws_mod._WebSocketDisconnect()

        async def close(self):
            pass

    server._sessions.clear()
    try:
        asyncio.run(ws_mod.handle_ws(FakeWS()))
    finally:
        server._sessions.clear()

    assert calls == [{"logger": ws_mod._log, "thread_name": "tui-ws-mcp-discovery"}]


def test_ws_long_handler_skips_default_executor_hop(monkeypatch):
    dispatch_threads = []
    dispatched_requests = []
    receive_count = 0
    sent = []

    monkeypatch.setattr(
        mcp_startup,
        "start_background_mcp_discovery",
        lambda **_kwargs: None,
    )

    def fake_dispatch(req, _transport):
        dispatch_threads.append(threading.get_ident())
        dispatched_requests.append(req)
        return None

    monkeypatch.setattr(server, "dispatch", fake_dispatch)
    monkeypatch.setattr(
        server,
        "agent_build_timing_snapshot",
        lambda: {
            "backend_agent_build_active_count": 1.0,
            "backend_agent_build_active_max_elapsed_ms": 412.5,
        },
    )

    class FakeWS:
        async def accept(self):
            pass

        async def send_text(self, line):
            sent.append(json.loads(line))

        async def receive_text(self):
            nonlocal receive_count
            receive_count += 1
            if receive_count == 1:
                return json.dumps(
                    {
                        "id": "resume",
                        "method": "session.resume",
                        "params": {"_transport_timing": True},
                    }
                )
            raise ws_mod._WebSocketDisconnect()

        async def close(self):
            pass

    async def run():
        loop_thread = threading.get_ident()
        await ws_mod.handle_ws(FakeWS())
        return loop_thread

    loop_thread = asyncio.run(run())

    assert dispatch_threads == [loop_thread]
    timing_params = dispatched_requests[0]["params"]
    assert timing_params[server._WS_RECEIVE_TO_ACK_PARAM] >= 0
    assert timing_params[server._WS_ACK_SEND_PARAM] >= 0
    assert sent[1] == {
        "jsonrpc": "2.0",
        "method": "event",
        "params": {
            "type": "gateway.request_received",
            "payload": {
                "request_id": "resume",
                "backend_agent_build_active_count": 1.0,
                "backend_agent_build_active_max_elapsed_ms": 412.5,
            },
        },
    }


def _run_disconnect(monkeypatch, seed):
    """Drive handle_ws to its disconnect `finally`, seeding sessions against the
    live WSTransport the moment it exists. Returns nothing; inspect _sessions."""
    # Disable the grace-reap Timer: detached sessions normally schedule a
    # threading.Timer via _schedule_ws_orphan_reap, which would outlive the test
    # and fire _reap during interpreter teardown — touching _sessions/DB and
    # producing spurious post-run errors under the per-file CI runner. Grace=0
    # short-circuits the Timer (see _schedule_ws_orphan_reap) so the test leaves
    # no lingering thread.
    monkeypatch.setattr(server, "_WS_ORPHAN_REAP_GRACE_S", 0)

    # Mirror the real _finalize_session chokepoint: it is the single place that
    # closes the slash-worker (#38095). Stub it but keep that behavior so the
    # disconnect-reap path still exercises worker teardown.
    def _fake_finalize(s, end_reason="tui_close"):
        w = s.get("slash_worker")
        if w:
            w.close()

    monkeypatch.setattr(server, "_finalize_session", _fake_finalize)

    created = []
    real_transport = ws_mod.WSTransport
    monkeypatch.setattr(
        ws_mod, "WSTransport",
        lambda ws, loop, **kw: created.append(real_transport(ws, loop, **kw)) or created[-1],
    )

    class FakeWS:
        async def accept(self):
            pass

        async def send_text(self, line):
            pass

        async def receive_text(self):
            seed(created[0])  # transport now exists; attach it to sessions
            raise ws_mod._WebSocketDisconnect()

        async def close(self):
            pass

    asyncio.run(ws_mod.handle_ws(FakeWS()))


def test_ws_disconnect_reaps_flagged_session_and_closes_worker(monkeypatch):
    closed = []

    class FakeWorker:
        def close(self):
            closed.append(True)

    server._sessions.clear()
    try:
        _run_disconnect(
            monkeypatch,
            lambda t: server._sessions.update(
                flagged={
                    "transport": t,
                    "close_on_disconnect": True,
                    "slash_worker": FakeWorker(),
                    "session_key": "k",
                }
            ),
        )
        assert "flagged" not in server._sessions
        assert closed == [True]
    finally:
        server._sessions.clear()


def test_ws_disconnect_preserves_and_repoints_reconnectable_session(monkeypatch):
    server._sessions.clear()
    try:
        _run_disconnect(
            monkeypatch,
            lambda t: server._sessions.update(
                plain={"transport": t, "close_on_disconnect": False, "session_key": "k"}
            ),
        )
        assert server._sessions["plain"]["transport"] is server._detached_ws_transport
    finally:
        server._sessions.clear()


def test_ws_write_loop_stall_does_not_latch_transport(monkeypatch):
    """A write that times out because the event loop is stalled (GIL-heavy
    agent turn) must NOT latch the transport closed — the frame is already
    scheduled and flushes when the loop recovers. Latching here permanently
    silenced live watch windows after one slow write."""
    monkeypatch.setattr(ws_mod, "_WS_WRITE_TIMEOUT_S", 0.05)
    sent = []

    class FakeWS:
        async def send_text(self, line):
            sent.append(line)

    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    try:
        transport = ws_mod.WSTransport(FakeWS(), loop, peer="stall-test")
        # Stall the loop well past the write timeout, then write from this
        # (non-loop) thread: the wait times out but the send stays in flight.
        loop.call_soon_threadsafe(time.sleep, 0.3)
        assert transport.write({"a": 1}) is True
        assert transport._closed is False

        # Once the loop breathes again, both the stalled frame and new writes
        # must reach the socket.
        assert transport.write({"b": 2}) is True
        deadline = time.time() + 2
        while len(sent) < 2 and time.time() < deadline:
            time.sleep(0.01)
        assert len(sent) == 2
        assert transport._closed is False
    finally:
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=2)
        loop.close()


def test_ws_timed_response_reports_event_loop_queue():
    sent = []

    class FakeWS:
        async def send_text(self, line):
            await asyncio.sleep(0.01)
            sent.append(json.loads(line))

    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    try:
        transport = ws_mod.WSTransport(FakeWS(), loop, peer="timing-test")
        response = {
            "id": "resume",
            "result": {
                "backend_timing_ms": {"handler_total": 1.0},
                "messages": [ws_mod._JSON_SERIALIZE_TIMING_MARKER],
                "resumed": "stored",
                "session_id": "runtime",
            },
        }

        assert transport.write(response) is True
        deadline = time.time() + 1
        while len(sent) < 2 and time.time() < deadline:
            time.sleep(0.01)
        response_timing = sent[0]["result"]["backend_timing_ms"]
        transport_event = sent[1]["params"]

        assert response_timing["event_loop_queue"] >= 0
        assert response_timing["json_serialize"] >= 0
        assert sent[0]["result"]["messages"] == [
            ws_mod._JSON_SERIALIZE_TIMING_MARKER
        ]
        assert transport_event["type"] == "gateway.transport_timing"
        assert transport_event["session_id"] == "runtime"
        assert transport_event["payload"]["stored_session_id"] == "stored"
        assert transport_event["payload"]["prefix_frame_count"] == 0
        assert transport_event["payload"]["response_send_ms"] >= 5
        assert transport_event["payload"]["send_total_ms"] >= 5
    finally:
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=2)
        loop.close()


def test_ws_timed_response_still_succeeds_when_transport_timing_event_fails():
    sent = []
    send_count = 0

    class FakeWS:
        async def send_text(self, line):
            nonlocal send_count
            send_count += 1
            if send_count == 1:
                sent.append(json.loads(line))
                return
            raise RuntimeError("transport timing event failed")

    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    try:
        transport = ws_mod.WSTransport(FakeWS(), loop, peer="timing-fail-test")
        response = {
            "id": "resume",
            "result": {
                "backend_timing_ms": {"handler_total": 1.0},
                "messages": [],
                "resumed": "stored",
                "session_id": "runtime",
            },
        }

        assert transport.write(response) is True
        assert send_count == 2
        assert sent[0]["id"] == "resume"
        assert transport._closed is True
    finally:
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=2)
        loop.close()
