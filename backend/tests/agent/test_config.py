import pytest

from jarvis_neuro.agent.config import AgentSettings, ConfigError, build_model, load_settings


def test_anthropic_defaults_follow_spec_section_5():
    s = load_settings({"MODEL_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": "k"})
    assert s == AgentSettings("anthropic", "claude-haiku-5-5", "claude-sonnet-5-5", "k")


def test_env_overrides_model_ids_and_provider_case():
    s = load_settings(
        {"MODEL_PROVIDER": " Gemini ", "GEMINI_API_KEY": "g", "ORCHESTRATOR_MODEL": "o", "REASONER_MODEL": "r"}
    )
    assert s == AgentSettings("gemini", "o", "r", "g")


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({}, "MODEL_PROVIDER must be one of gemini, anthropic"),
        ({"MODEL_PROVIDER": "openai", "ANTHROPIC_API_KEY": "k"}, "got 'openai'"),
        ({"MODEL_PROVIDER": "anthropic"}, "ANTHROPIC_API_KEY is not set"),
        ({"MODEL_PROVIDER": "gemini", "GEMINI_API_KEY": "g"}, "ORCHESTRATOR_MODEL is required"),
        ({"MODEL_PROVIDER": "gemini", "GEMINI_API_KEY": "g", "ORCHESTRATOR_MODEL": "o"}, "REASONER_MODEL is required"),
    ],
)
def test_bad_environments_fail_with_a_named_variable(env, message):
    with pytest.raises(ConfigError, match=message):
        load_settings(env)


@pytest.mark.parametrize("provider", ["anthropic", "gemini"])
def test_build_model_sets_the_model_id_without_network(provider):
    s = AgentSettings(provider, "orch-id", "reason-id", "key")
    assert build_model(s, "orch-id").get_config()["model_id"] == "orch-id"


def test_settings_repr_hides_api_key():
    settings = AgentSettings('anthropic', 'orch', 'reason', 'secret-api-key')
    assert 'secret-api-key' not in repr(settings)
    assert 'anthropic' in repr(settings)
