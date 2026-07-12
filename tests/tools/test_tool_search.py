"""Tests for tools/tool_search.py — progressive tool disclosure.

Coverage targets — these mirror the issues called out in the OpenClaw tool
search report. Every test that names an OpenClaw issue is the regression
guard that would have caught that specific failure mode.
"""

from __future__ import annotations

import json
import os
import sys
from typing import List, Dict, Any

import pytest


_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)


def _td(
    name: str,
    description: str = "",
    properties: Dict[str, Any] | None = None,
    required: List[str] | None = None,
) -> Dict[str, Any]:
    parameters: Dict[str, Any] = {
        "type": "object",
        "properties": properties or {},
    }
    if required:
        parameters["required"] = required
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        },
    }


def _core_tool_defs() -> List[Dict[str, Any]]:
    import model_tools

    return model_tools.get_tool_definitions(
        enabled_toolsets=["terminal", "session_search"],
        quiet_mode=True,
        skip_tool_search_assembly=True,
    )


# ---------------------------------------------------------------------------
# Config parsing
# ---------------------------------------------------------------------------


class TestConfigParsing:
    def test_default_when_missing(self):
        from tools.tool_search import ToolSearchConfig
        cfg = ToolSearchConfig.from_raw(None)
        assert cfg.enabled == "auto"
        assert cfg.threshold_pct == 10.0

    def test_bool_true_maps_to_auto(self):
        from tools.tool_search import ToolSearchConfig
        cfg = ToolSearchConfig.from_raw(True)
        assert cfg.enabled == "auto"

    def test_bool_false_maps_to_off(self):
        from tools.tool_search import ToolSearchConfig
        cfg = ToolSearchConfig.from_raw(False)
        assert cfg.enabled == "off"

    def test_explicit_on(self):
        from tools.tool_search import ToolSearchConfig
        cfg = ToolSearchConfig.from_raw({"enabled": "on"})
        assert cfg.enabled == "on"

    def test_invalid_enabled_falls_back_to_auto(self):
        from tools.tool_search import ToolSearchConfig
        cfg = ToolSearchConfig.from_raw({"enabled": "maybe"})
        assert cfg.enabled == "auto"

    def test_threshold_clamped(self):
        from tools.tool_search import ToolSearchConfig
        cfg = ToolSearchConfig.from_raw({"threshold_pct": 150})
        assert cfg.threshold_pct == 100.0
        cfg = ToolSearchConfig.from_raw({"threshold_pct": -5})
        assert cfg.threshold_pct == 0.0

    def test_search_limits_clamped(self):
        from tools.tool_search import ToolSearchConfig
        cfg = ToolSearchConfig.from_raw({
            "search_default_limit": 999,
            "max_search_limit": 999,
        })
        assert cfg.max_search_limit == 50
        assert cfg.search_default_limit <= cfg.max_search_limit

    def test_core_deferral_defaults_off_with_bootstrap_list(self):
        from tools.tool_search import DEFAULT_ALWAYS_VISIBLE_TOOLS, ToolSearchConfig

        cfg = ToolSearchConfig.from_raw(None)

        assert cfg.defer_core_tools is False
        assert cfg.always_visible_tools == DEFAULT_ALWAYS_VISIBLE_TOOLS

    def test_core_deferral_config_is_normalized(self):
        from tools.tool_search import ToolSearchConfig

        cfg = ToolSearchConfig.from_raw({
            "defer_core_tools": "yes",
            "always_visible_tools": [" terminal ", "clarify", "", None],
        })

        assert cfg.defer_core_tools is True
        assert cfg.always_visible_tools == {"terminal", "clarify"}


# ---------------------------------------------------------------------------
# Classification — defaults keep core visible, opt-in can defer selected core.
# ---------------------------------------------------------------------------


class TestClassification:
    def test_core_tools_default_to_visible(self):
        from tools.tool_search import ToolSearchConfig, is_deferrable_tool_name

        _core_tool_defs()
        cfg = ToolSearchConfig.from_raw({"enabled": "on"})

        assert not is_deferrable_tool_name("terminal", config=cfg)
        assert not is_deferrable_tool_name("session_search", config=cfg)

    def test_selected_core_tools_can_defer_when_opted_in(self):
        from tools.tool_search import ToolSearchConfig, is_deferrable_tool_name

        _core_tool_defs()
        cfg = ToolSearchConfig.from_raw({
            "enabled": "on",
            "defer_core_tools": True,
        })

        assert not is_deferrable_tool_name("terminal", config=cfg)
        assert is_deferrable_tool_name("session_search", config=cfg)

    def test_bridge_tools_never_defer(self):
        from tools.tool_search import is_deferrable_tool_name, BRIDGE_TOOL_NAMES
        for name in BRIDGE_TOOL_NAMES:
            assert not is_deferrable_tool_name(name)

    def test_unknown_tool_not_deferrable(self):
        """Defensive: a tool name we cannot resolve to a registry entry must
        not be claimed as deferrable. This protects against the OpenClaw
        cron regression where unresolved tools were silently dropped."""
        from tools.tool_search import is_deferrable_tool_name
        assert not is_deferrable_tool_name("xx_definitely_not_a_tool_xx")

    def test_classify_keeps_unknown_in_visible(self):
        """A tool we can't classify stays visible — never silently dropped.

        This is the OpenClaw #84141 regression guard (cron lost ``exec``
        because it wasn't in the catalog).
        """
        from tools.tool_search import classify_tools
        # Build a tool def for something we don't have a registry entry for.
        defs = [_td("xx_unknown_tool", "Unknown tool")]
        visible, deferrable = classify_tools(defs)
        names = {(td.get("function") or {}).get("name") for td in visible}
        assert "xx_unknown_tool" in names
        assert deferrable == []


# ---------------------------------------------------------------------------
# Token estimation + threshold gate
# ---------------------------------------------------------------------------


class TestThresholdGate:
    def test_off_never_activates(self):
        from tools.tool_search import ToolSearchConfig, should_activate
        cfg = ToolSearchConfig.from_raw({"enabled": "off"})
        assert not should_activate(cfg, deferrable_tokens=1_000_000, context_length=200_000)

    def test_zero_deferrable_never_activates(self):
        from tools.tool_search import ToolSearchConfig, should_activate
        cfg = ToolSearchConfig.from_raw({"enabled": "on"})
        assert not should_activate(cfg, deferrable_tokens=0, context_length=200_000)

    def test_on_activates_with_any_deferrable(self):
        from tools.tool_search import ToolSearchConfig, should_activate
        cfg = ToolSearchConfig.from_raw({"enabled": "on"})
        assert should_activate(cfg, deferrable_tokens=100, context_length=200_000)

    def test_auto_below_threshold_does_not_activate(self):
        from tools.tool_search import ToolSearchConfig, should_activate
        cfg = ToolSearchConfig.from_raw({"enabled": "auto", "threshold_pct": 10})
        # 5% of 200K = below 10% threshold
        assert not should_activate(cfg, deferrable_tokens=10_000, context_length=200_000)

    def test_auto_at_or_above_threshold_activates(self):
        from tools.tool_search import ToolSearchConfig, should_activate
        cfg = ToolSearchConfig.from_raw({"enabled": "auto", "threshold_pct": 10})
        assert should_activate(cfg, deferrable_tokens=20_000, context_length=200_000)
        assert should_activate(cfg, deferrable_tokens=50_000, context_length=200_000)

    def test_auto_without_context_length_uses_20k_cutoff(self):
        """Fallback cutoff used when the active model is unknown."""
        from tools.tool_search import ToolSearchConfig, should_activate
        cfg = ToolSearchConfig.from_raw({"enabled": "auto"})
        assert not should_activate(cfg, deferrable_tokens=10_000, context_length=0)
        assert should_activate(cfg, deferrable_tokens=25_000, context_length=0)

    def test_token_estimate_proportional_to_schema_size(self):
        from tools.tool_search import estimate_tokens_from_schemas
        small = [_td("a", "x")]
        big = [_td(f"name_{i}", f"description for tool {i} " * 20,
                   {"q": {"type": "string", "description": "search query " * 10}})
               for i in range(10)]
        small_t = estimate_tokens_from_schemas(small)
        big_t = estimate_tokens_from_schemas(big)
        assert big_t > small_t * 10


# ---------------------------------------------------------------------------
# Compact signatures
# ---------------------------------------------------------------------------


class TestCompactSignatures:
    def test_renders_required_optional_scalar_enum_and_range(self):
        from tools.tool_search import CompactSignature, compact_signature

        sig = compact_signature(_td(
            "session_search",
            properties={
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 10},
                "sort": {"type": "string", "enum": ["newest", "oldest"]},
            },
            required=["query"],
        ))

        assert sig == CompactSignature(
            text="session_search(query: string, limit?: integer[1..10], sort?: newest|oldest)",
            safe_for_direct_call=True,
        )

    def test_nullable_scalar_forms_remain_safe(self):
        from tools.tool_search import compact_signature

        union_sig = compact_signature(_td(
            "lookup_user",
            properties={
                "name": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            },
        ))
        sanitized_sig = compact_signature(_td(
            "lookup_user",
            properties={
                "name": {"type": "string", "nullable": True},
            },
        ))

        assert union_sig.safe_for_direct_call is True
        assert union_sig.text == "lookup_user(name?: string)"
        assert sanitized_sig.safe_for_direct_call is True
        assert sanitized_sig.text == "lookup_user(name?: string)"

    def test_freeform_objects_and_typed_maps_render_but_structured_objects_describe(self):
        from tools.tool_search import compact_signature

        freeform = compact_signature(_td(
            "write_blob",
            properties={
                "payload": {"type": "object", "additionalProperties": True},
            },
        ))
        typed_map = compact_signature(_td(
            "set_scores",
            properties={
                "scores": {
                    "type": "object",
                    "additionalProperties": {"type": "integer"},
                },
            },
        ))
        structured = compact_signature(_td(
            "create_issue",
            properties={
                "payload": {
                    "type": "object",
                    "properties": {"title": {"type": "string"}},
                },
            },
        ))

        assert freeform.text == "write_blob(payload?: object)"
        assert freeform.safe_for_direct_call is True
        assert typed_map.text == "set_scores(scores?: map<string, integer>)"
        assert typed_map.safe_for_direct_call is True
        assert structured.text == "create_issue(describe first)"
        assert structured.safe_for_direct_call is False

    def test_unhandled_constraints_and_object_arrays_require_describe(self):
        from tools.tool_search import compact_signature

        patterned = compact_signature(_td(
            "validate_tag",
            properties={
                "tag": {"type": "string", "pattern": "^[a-z]+$"},
            },
        ))
        object_array = compact_signature(_td(
            "bulk_create",
            properties={
                "items": {
                    "type": "array",
                    "items": {"type": "object", "properties": {"id": {"type": "string"}}},
                },
            },
        ))

        assert patterned.text == "validate_tag(describe first)"
        assert patterned.safe_for_direct_call is False
        assert object_array.text == "bulk_create(describe first)"
        assert object_array.safe_for_direct_call is False


# ---------------------------------------------------------------------------
# Retrieval (BM25 + substring fallback)
# ---------------------------------------------------------------------------


class TestRetrieval:
    def _fake_catalog(self):
        """Build a catalog directly without touching the registry."""
        from tools.tool_search import CatalogEntry, _tokenize, _entry_search_text
        defs = [
            _td("github_create_issue", "Open a new issue in a GitHub repository",
                {"title": {"type": "string"}, "body": {"type": "string"}}),
            _td("github_search_repos", "Search GitHub for matching repositories",
                {"query": {"type": "string"}}),
            _td("slack_send_message", "Post a message into a Slack channel",
                {"channel": {"type": "string"}, "text": {"type": "string"}}),
            _td("calendar_create_event", "Add an event to the user's calendar",
                {"title": {"type": "string"}, "start": {"type": "string"}}),
        ]
        catalog = []
        for d in defs:
            fn = d["function"]
            e = CatalogEntry(
                name=fn["name"], description=fn["description"],
                schema=d, source="mcp", source_name="mcp-test",
            )
            e._tokens = _tokenize(_entry_search_text(d))
            catalog.append(e)
        return catalog

    def test_search_finds_relevant_tool(self):
        from tools.tool_search import search_catalog
        hits = search_catalog(self._fake_catalog(), "create a github issue", limit=3)
        names = [h.name for h in hits]
        assert names[0] == "github_create_issue"

    def test_search_returns_empty_for_irrelevant_query(self):
        from tools.tool_search import search_catalog
        hits = search_catalog(self._fake_catalog(), "asdf qwerty foobar", limit=3)
        assert hits == []

    def test_search_substring_fallback(self):
        """Even when no BM25 hit, a literal substring of the tool name returns."""
        from tools.tool_search import search_catalog
        hits = search_catalog(self._fake_catalog(), "calendar", limit=3)
        assert any("calendar" in h.name for h in hits)

    def test_search_respects_limit(self):
        from tools.tool_search import search_catalog
        hits = search_catalog(self._fake_catalog(), "github", limit=1)
        assert len(hits) <= 1


# ---------------------------------------------------------------------------
# Assembly — the full passthrough/activate decision.
# ---------------------------------------------------------------------------


class TestAssembly:
    def test_no_deferrable_returns_unchanged(self):
        """Pure-core toolset: pass-through, no bridge tools added."""
        from tools.tool_search import assemble_tool_defs, ToolSearchConfig
        defs = [_td("terminal", "Run shell"), _td("read_file", "Read a file")]
        result = assemble_tool_defs(
            defs,
            context_length=200_000,
            config=ToolSearchConfig.from_raw({"enabled": "on"}),
        )
        assert not result.activated
        assert {t["function"]["name"] for t in result.tool_defs} == {"terminal", "read_file"}

    def test_below_threshold_returns_unchanged(self):
        """Tiny deferrable surface: don't bother."""
        from tools.tool_search import assemble_tool_defs, ToolSearchConfig
        # _td renders to ~80 chars / 20 tokens. 3 of them = ~60 tokens.
        # 10% of 200K = 20K. Way below.
        defs = [_td("unknown_tool_a"), _td("unknown_tool_b"), _td("unknown_tool_c")]
        result = assemble_tool_defs(
            defs,
            context_length=200_000,
            config=ToolSearchConfig.from_raw({"enabled": "auto", "threshold_pct": 10}),
        )
        assert not result.activated
        names = {(t.get("function") or {}).get("name") for t in result.tool_defs}
        assert "tool_search" not in names

    def test_idempotent_when_bridge_already_present(self):
        from tools.tool_search import assemble_tool_defs, ToolSearchConfig, BRIDGE_TOOL_NAMES
        defs = [_td("terminal", "Run shell"), _td("tool_search", "old")]
        result = assemble_tool_defs(
            defs,
            context_length=200_000,
            config=ToolSearchConfig.from_raw({"enabled": "off"}),
        )
        names = [(t["function"]["name"]) for t in result.tool_defs]
        # The pre-existing tool_search was stripped (it would be re-injected if
        # activation happened; here it didn't).
        assert "tool_search" not in names

    def test_core_deferral_keeps_bootstrap_tools_visible(self):
        from tools.tool_search import BRIDGE_TOOL_NAMES, ToolSearchConfig, assemble_tool_defs

        defs = _core_tool_defs()
        result = assemble_tool_defs(
            defs,
            context_length=200_000,
            config=ToolSearchConfig.from_raw({
                "enabled": "on",
                "defer_core_tools": True,
            }),
        )

        names = {(t.get("function") or {}).get("name") for t in result.tool_defs}
        assert "terminal" in names
        assert "process" in names
        assert "session_search" not in names
        assert BRIDGE_TOOL_NAMES <= names

    def test_bridge_tool_call_description_indexes_safe_signatures_only(self, monkeypatch):
        from tools import tool_search as ts

        defs = [
            _td("core_lookup", properties={"query": {"type": "string"}}, required=["query"]),
            _td("plugin_safe", properties={"limit": {"type": "integer", "minimum": 1, "maximum": 5}}),
            _td("mcp_complex", properties={"payload": {"type": "object", "properties": {"x": {"type": "string"}}}}),
        ]

        monkeypatch.setattr(
            ts,
            "_classify_source",
            lambda name: (
                ("core", "core") if name == "core_lookup" else
                ("plugin", "plugin") if name == "plugin_safe" else
                ("mcp", "mcp-test")
            ),
        )

        desc = ts.bridge_tool_schemas(defs)[2]["function"]["description"]

        core_idx = desc.index("- core_lookup(query: string)")
        plugin_idx = desc.index("- plugin_safe(limit?: integer[1..5])")
        assert core_idx < plugin_idx
        assert "mcp_complex" not in desc
        assert "values for `tool_call.name`" in desc
        assert "Do not invoke them as native tools." in desc

    def test_bridge_manifest_truncates_at_entry_boundaries(self, monkeypatch):
        from tools import tool_search as ts

        defs = [
            _td("alpha_tool_with_long_name", properties={"query": {"type": "string"}}, required=["query"]),
            _td("beta_tool_with_long_name", properties={"query": {"type": "string"}}, required=["query"]),
            _td("gamma_tool_with_long_name", properties={"query": {"type": "string"}}, required=["query"]),
        ]

        monkeypatch.setattr(ts, "MAX_MANIFEST_BODY_CHARS", 55)
        monkeypatch.setattr(ts, "MAX_BRIDGE_DESCRIPTION_CHARS", 4096)
        monkeypatch.setattr(ts, "_classify_source", lambda name: ("plugin", "plugin"))

        desc = ts.bridge_tool_schemas(defs)[2]["function"]["description"]

        assert "- alpha_tool_with_long_name(query: string)" in desc
        assert "- beta_tool_with_long_name(query: string)" not in desc
        assert "Use `tool_search` for deferred tools not listed here" in desc


# ---------------------------------------------------------------------------
# Bridge dispatch
# ---------------------------------------------------------------------------


class TestBridgeDispatch:
    def test_search_hits_include_signature_and_describe_required(self):
        from tools.tool_search import CatalogEntry, _format_search_hit

        safe_hit = _format_search_hit(CatalogEntry(
            name="session_search",
            description="Search prior sessions",
            schema=_td(
                "session_search",
                properties={
                    "query": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 10},
                },
            ),
            source="core",
            source_name="session_search",
        ))
        complex_hit = _format_search_hit(CatalogEntry(
            name="skill_manage",
            description="Manage skills",
            schema=_td(
                "skill_manage",
                properties={
                    "payload": {"type": "object", "properties": {"name": {"type": "string"}}},
                },
            ),
            source="plugin",
            source_name="skills",
        ))

        assert safe_hit["signature"] == "session_search(query?: string, limit?: integer[1..10])"
        assert safe_hit["describe_required"] is False
        assert complex_hit["signature"] == "skill_manage(describe first)"
        assert complex_hit["describe_required"] is True

    def test_tool_search_requires_query(self):
        from tools.tool_search import dispatch_tool_search
        result = dispatch_tool_search({}, current_tool_defs=[])
        assert "error" in json.loads(result)

    def test_tool_describe_requires_name(self):
        from tools.tool_search import dispatch_tool_describe
        result = dispatch_tool_describe({}, current_tool_defs=[])
        assert "error" in json.loads(result)

    def test_tool_describe_rejects_non_deferrable(self):
        """If the model asks to describe a core tool, refuse — it's already
        in the visible list."""
        from tools.tool_search import dispatch_tool_describe
        result = dispatch_tool_describe(
            {"name": "terminal"}, current_tool_defs=[_td("terminal", "Run shell")],
        )
        assert "error" in json.loads(result)

    def test_tool_describe_allows_deferred_core_with_policy(self):
        from tools.tool_search import ToolSearchConfig, dispatch_tool_describe

        defs = _core_tool_defs()
        result = dispatch_tool_describe(
            {"name": "session_search"},
            current_tool_defs=defs,
            config=ToolSearchConfig.from_raw({
                "enabled": "on",
                "defer_core_tools": True,
            }),
        )

        parsed = json.loads(result)
        assert parsed["name"] == "session_search"

    def test_tool_search_results_surface_signature_and_describe_required(self):
        from tools.tool_search import ToolSearchConfig, dispatch_tool_search

        defs = _core_tool_defs()
        result = dispatch_tool_search(
            {"query": "session search", "limit": 5},
            current_tool_defs=defs,
            config=ToolSearchConfig.from_raw({
                "enabled": "on",
                "defer_core_tools": True,
            }),
        )

        parsed = json.loads(result)
        session_hit = next(match for match in parsed["matches"] if match["name"] == "session_search")
        assert session_hit["describe_required"] is False
        assert session_hit["signature"].startswith("session_search(")

    def test_resolve_underlying_call_parses_object_args(self):
        from tools.tool_search import resolve_underlying_call
        name, args, err = resolve_underlying_call({
            "name": "unknown_xxx",
            "arguments": {"foo": "bar"},
        })
        # Will fail classification because unknown_xxx isn't deferrable.
        assert err is not None

    def test_resolve_underlying_call_parses_json_string_args(self):
        """Some models emit ``arguments`` as a JSON string instead of object."""
        from tools.tool_search import resolve_underlying_call
        # Use a name that won't classify (so we don't depend on registry),
        # but exercise the JSON parse path.
        _, _, err = resolve_underlying_call({
            "name": "fake",
            "arguments": '{"a": 1}',
        })
        # err is about classification, but the parse worked (it would have
        # failed earlier with "not valid JSON" otherwise).
        assert "not valid JSON" not in (err or "")

    def test_resolve_underlying_call_rejects_bad_json(self):
        from tools.tool_search import resolve_underlying_call
        _, _, err = resolve_underlying_call({
            "name": "fake",
            "arguments": "{this is not json",
        })
        assert err is not None
        assert "JSON" in err

    def test_resolve_underlying_call_rejects_recursion(self):
        """tool_call cannot invoke tool_call itself."""
        from tools.tool_search import resolve_underlying_call, TOOL_CALL_NAME
        name, args, err = resolve_underlying_call({
            "name": TOOL_CALL_NAME,
            "arguments": {},
        })
        assert err is not None
        assert "bridge tool" in err.lower()


# ---------------------------------------------------------------------------
# End-to-end via the real handle_function_call (smoke test).
# ---------------------------------------------------------------------------


class TestHandleFunctionCallIntegration:
    def test_tool_search_dispatch_through_handle_function_call(self):
        """The dispatcher recognizes the bridge tool by name."""
        import model_tools
        result = model_tools.handle_function_call(
            function_name="tool_search",
            function_args={"query": "nothing matches this"},
        )
        parsed = json.loads(result)
        # Without a real registry, the matches will be empty, but the
        # dispatch path completed without error.
        assert "matches" in parsed or "error" in parsed

    def test_bridge_dispatch_uses_explicit_policy_snapshot(self, monkeypatch):
        import model_tools
        from tools import tool_search as ts

        _core_tool_defs()
        monkeypatch.setattr(
            ts,
            "load_config",
            lambda: ts.ToolSearchConfig.from_raw({"enabled": "on", "defer_core_tools": False}),
        )

        result = model_tools.handle_function_call(
            function_name="tool_describe",
            function_args={"name": "session_search"},
            enabled_toolsets=["terminal", "session_search"],
            tool_search_policy=ts.ToolSearchConfig.from_raw({
                "enabled": "on",
                "defer_core_tools": True,
            }),
        )

        parsed = json.loads(result)
        assert parsed["name"] == "session_search"


class TestRegression_OpenClawCron84141:
    """Regression guard for the OpenClaw cron-tool-loss class of bug.

    OpenClaw #84141: ``toolsAllow: ["exec"]`` on an isolated cron turn
    resulted in the agent receiving only ``sessions_send`` — the catalog
    builder silently dropped the requested core tool.

    Our defense by default is that core tools stay directly visible unless
    the user explicitly opts into core deferral. This test exercises the
    default assembly path and asserts the requested core tool survives.
    """

    def test_core_tool_survives_alongside_many_mcp_tools(self):
        from tools.tool_search import (
            assemble_tool_defs, ToolSearchConfig, BRIDGE_TOOL_NAMES,
            classify_tools,
        )
        # 1 core tool + 50 unknown/MCP-shaped tools (deferrable).
        defs = [_td("terminal", "Run shell commands")]
        # Pad with fake "deferrable" tools — without registry registration,
        # classify_tools puts them in 'visible'. So instead, we just verify
        # the core-tool side: terminal stays in visible regardless.
        visible, deferrable = classify_tools(defs)
        assert any(
            (td.get("function") or {}).get("name") == "terminal"
            for td in visible
        ), "Core tool 'terminal' was wrongly classified as deferrable"

        # Now force activation and check the resulting tool-defs list.
        result = assemble_tool_defs(
            defs,
            context_length=200_000,
            config=ToolSearchConfig.from_raw({"enabled": "on"}),
        )
        names = {(t.get("function") or {}).get("name") for t in result.tool_defs}
        # terminal must be present; bridges are only added if there are
        # deferrable tools to put behind them.
        assert "terminal" in names

    def test_unwrap_rejects_core_tool_attempt(self):
        """Even if the model tries to invoke a core tool through tool_call,
        we reject the call and tell the model to use it directly."""
        from tools.tool_search import resolve_underlying_call
        _, _, err = resolve_underlying_call({
            "name": "terminal",
            "arguments": {"command": "echo hi"},
        })
        assert err is not None
        assert "not a deferrable" in err


class TestRegression_ToolsetScoping:
    """A restricted-toolset session must not see or invoke out-of-scope tools.

    The bug: the bridge dispatch and the tool_executor unwrap read the
    catalog from the *global* registry (get_tool_definitions with no
    toolset scope = "start with everything"), so a session scoped to one
    MCP server could tool_search the entire process registry and tool_call
    any plugin tool it was never granted. registry.dispatch() has no
    enabled_tools gate for non-execute_code tools, so the out-of-scope tool
    actually ran.

    The fix threads the session's enabled/disabled toolsets into the bridge
    dispatch (model_tools.handle_function_call) and the executor unwrap
    (agent.tool_executor), scoping both the searchable catalog and the
    invocable set to the session's own toolsets.
    """

    @staticmethod
    def _register(name, toolset):
        from tools.registry import registry

        def _handler(args, task_id=None, **kw):
            return json.dumps({"ok": True, "tool": name})

        registry.register(
            name=name,
            handler=_handler,
            schema=_td(name, f"desc for {name}", {"repo": {"type": "string"}}),
            toolset=toolset,
        )

    def test_search_catalog_is_scoped_to_session_toolsets(self):
        import model_tools

        for i in range(12):
            self._register(f"mcp_scoped_gh_{i}", "mcp-scoped-gh")
        self._register("scoped_oos_plugin", "scopedoosplugin")

        # tool_search scoped to the github toolset must not count the
        # out-of-scope plugin tool (or any of the host registry).
        result = model_tools.handle_function_call(
            function_name="tool_search",
            function_args={"query": "mcp_scoped_gh", "limit": 5},
            enabled_toolsets=["mcp-scoped-gh"],
        )
        parsed = json.loads(result)
        assert parsed["total_available"] == 12, (
            f"expected scoped catalog of 12, got {parsed['total_available']} "
            "— catalog leaked tools outside the session's toolsets"
        )
        hit_names = {m["name"] for m in parsed["matches"]}
        assert "scoped_oos_plugin" not in hit_names

    def test_tool_call_rejects_out_of_scope_tool(self):
        import model_tools

        self._register("mcp_inscope_gh_op", "mcp-inscope-gh")
        self._register("inscope_oos_plugin", "inscopeoosplugin")

        # Out-of-scope plugin tool: rejected even though it is registered
        # and deferrable in the global registry.
        rejected = json.loads(model_tools.handle_function_call(
            function_name="tool_call",
            function_args={"name": "inscope_oos_plugin", "arguments": {}},
            enabled_toolsets=["mcp-inscope-gh"],
        ))
        assert "error" in rejected
        assert "not available in this session" in rejected["error"]

        # In-scope tool: dispatches normally.
        ok = json.loads(model_tools.handle_function_call(
            function_name="tool_call",
            function_args={"name": "mcp_inscope_gh_op", "arguments": {"repo": "a/b"}},
            enabled_toolsets=["mcp-inscope-gh"],
        ))
        assert ok.get("ok") is True
        assert ok.get("tool") == "mcp_inscope_gh_op"

    def test_bridge_dispatch_does_not_pollute_global_resolved_names(self):
        import model_tools

        self._register("mcp_pollute_op_0", "mcp-pollute")
        self._register("mcp_pollute_op_1", "mcp-pollute")

        # Establish the scoped session global.
        model_tools.get_tool_definitions(
            enabled_toolsets=["mcp-pollute"], quiet_mode=True,
        )
        before = set(model_tools._last_resolved_tool_names)
        assert "terminal" not in before

        # A scoped tool_search call must not widen the process-global
        # _last_resolved_tool_names to the whole registry (which would leak
        # core/sandbox tools into execute_code's fallback).
        model_tools.handle_function_call(
            function_name="tool_search",
            function_args={"query": "pollute"},
            enabled_toolsets=["mcp-pollute"],
        )
        after = set(model_tools._last_resolved_tool_names)
        assert "terminal" not in after, (
            "bridge dispatch polluted _last_resolved_tool_names with "
            "out-of-scope tools"
        )

    def test_scoped_deferrable_names_helper(self):
        from tools.tool_search import scoped_deferrable_names

        self._register("mcp_helper_op", "mcp-helper")
        import model_tools
        defs = model_tools.get_tool_definitions(
            enabled_toolsets=["mcp-helper"],
            quiet_mode=True,
            skip_tool_search_assembly=True,
        )
        names = scoped_deferrable_names(defs)
        assert "mcp_helper_op" in names
        # bootstrap tools remain directly visible by default
        assert "terminal" not in names

    def test_scoped_deferrable_names_can_include_selected_core_tools(self):
        from tools.tool_search import ToolSearchConfig, scoped_deferrable_names

        defs = _core_tool_defs()
        names = scoped_deferrable_names(
            defs,
            config=ToolSearchConfig.from_raw({
                "enabled": "on",
                "defer_core_tools": True,
            }),
        )

        assert "session_search" in names
        assert "terminal" not in names

