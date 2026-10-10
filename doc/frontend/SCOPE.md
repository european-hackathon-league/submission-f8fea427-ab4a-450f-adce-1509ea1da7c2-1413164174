# Frontend integration scope

Controlling specification: [`frontend_plan.md`](../../frontend_plan.md), together with [`plan.md`](../../plan.md). The user explicitly selected the car, graph and Deep Dive workspace in that plan. `PITCH-PLAN.md` is an archived earlier brief, not the controlling specification.

Branch `frontend` consolidates the completed pitch UI and vehicle viewer from `codex/pitch-ui`, `codex/pitch-workspace-ui` and `codex/pitch-vehicle-3d`, based on main at `80e328e`. Integrated fixes take precedence over older worktree versions. The rejected procedural sedan remains excluded.

This is a consolidation checkpoint, not completion of the newer scope rebuild. The current prototype still has older navigation and comparison features. Removing those extras and implementing the graph, versioned backend adapter, Deep Dive and Reimagine contracts remain pending. Interrupted work is preserved in the `frontend-plan-only`, `frontend-plan-3d` and `pitch-visual-redesign` worktrees; it is not included in the runnable checkpoint.

The i5 M60 exterior uses a hosted creator model. The interior is a separately credited G60 520i reference photograph, not a verified 3D M60 cabin. All metrics and research are synthetic. Backend branches and source data are outside this consolidation.
