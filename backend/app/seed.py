from app.config import Settings
from app.db import Membership, Session, Workspace


def main() -> None:
    if Settings().environment == "production":
        raise SystemExit("Synthetic demo seed is forbidden in production")
    with Session.begin() as session:
        session.merge(Workspace(id="workspace_demo"))
        session.flush()
        session.merge(
            Membership(workspace_id="workspace_demo", actor_id="pm_demo", role="pm")
        )


if __name__ == "__main__":
    main()
