"""Client-side bus scaffold for MuseAI Chat2.

Add the application's message transport and event handling here.
"""


class Bus:
    """Placeholder message bus interface."""

    def send(self, message: str) -> None:
        """Send a message (implementation not yet configured)."""
        raise NotImplementedError("Configure a transport before sending messages")
