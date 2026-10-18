"""Model provider selection from environment variables (spec §1 Stack). No provider is hard-coded."""
import os
from collections.abc import Mapping
from dataclasses import dataclass, field

from strands.models.model import Model

PROVIDERS = ("gemini", "anthropic")
# Spec §5 defaults, Anthropic provider only.
ANTHROPIC_DEFAULTS = {"ORCHESTRATOR_MODEL": "claude-haiku-5-5", "REASONER_MODEL": "claude-sonnet-5-5"}
KEY_VAR = {"gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}
MAX_TOKENS = 1024
DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000"
)


def normalise_origin(origin: str) -> str:
    return origin.strip().rstrip("/").lower()


def allowed_origins() -> set[str]:
    """Browser origins allowed to open the agent socket; non-browser clients may omit Origin."""
    value = os.environ.get("AGENT_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
    return {origin for entry in value.split(",") if (origin := normalise_origin(entry))}


class ConfigError(ValueError):
    """The environment does not describe a usable model provider."""


@dataclass(frozen=True)
class AgentSettings:
    provider: str
    orchestrator_model: str
    reasoner_model: str
    api_key: str = field(repr=False)


def load_settings(env: Mapping[str, str] | None = None) -> AgentSettings:
    env = os.environ if env is None else env
    provider = env.get("MODEL_PROVIDER", "").strip().lower()
    if provider not in PROVIDERS:
        raise ConfigError(f"MODEL_PROVIDER must be one of {', '.join(PROVIDERS)}; got {provider!r}")
    key = env.get(KEY_VAR[provider], "").strip()
    if not key:
        raise ConfigError(f"{KEY_VAR[provider]} is not set")

    def model_id(var: str) -> str:
        value = env.get(var, "").strip()
        if value:
            return value
        if provider == "anthropic":
            return ANTHROPIC_DEFAULTS[var]
        raise ConfigError(f"{var} is required when MODEL_PROVIDER={provider}")

    return AgentSettings(provider, model_id("ORCHESTRATOR_MODEL"), model_id("REASONER_MODEL"), key)


def build_model(settings: AgentSettings, model_id: str) -> Model:
    """A Strands model for one role. Constructing it makes no network call."""
    if settings.provider == "anthropic":
        from strands.models.anthropic import AnthropicModel

        return AnthropicModel(client_args={"api_key": settings.api_key}, model_id=model_id, max_tokens=MAX_TOKENS)
    from strands.models.gemini import GeminiModel

    return GeminiModel(client_args={"api_key": settings.api_key}, model_id=model_id)
