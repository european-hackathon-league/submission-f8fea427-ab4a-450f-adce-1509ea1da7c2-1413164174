import socket

import pytest

from app.research import retrieve


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://user:password@example.com",
        "http://example.com:8080",
    ],
)
def test_research_rejects_unsafe_schemes_credentials_and_ports(url):
    with pytest.raises(ValueError):
        retrieve(url, max_bytes=1024, timeout=1)


def test_research_rejects_private_dns_before_connecting(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80))
        ],
    )
    with pytest.raises(ValueError, match="public network"):
        retrieve("http://example.com", max_bytes=1024, timeout=1)


def test_public_redirect_to_private_network_is_rejected(monkeypatch):
    import http.client

    connections = []

    def addresses(host, *args, **kwargs):
        address = "127.0.0.1" if host == "localhost" else "93.184.216.34"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 80))]

    class Response:
        status = 302

        def getheader(self, name, default=None):
            return "http://localhost/private" if name == "Location" else default

    class Connection:
        def __init__(self, *args, **kwargs):
            pass

        def request(self, *args, **kwargs):
            pass

        def getresponse(self):
            return Response()

        def close(self):
            pass

    monkeypatch.setattr(socket, "getaddrinfo", addresses)
    monkeypatch.setattr(
        socket,
        "create_connection",
        lambda address, **kwargs: connections.append(address),
    )
    monkeypatch.setattr(http.client, "HTTPConnection", Connection)
    with pytest.raises(ValueError, match="public network"):
        retrieve("http://example.com", max_bytes=1024, timeout=1)
    assert connections == [("93.184.216.34", 80)]
