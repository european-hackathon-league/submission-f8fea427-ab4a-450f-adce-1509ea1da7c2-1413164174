export type ComponentId =
  "steering" | "dashboard" | "seats" | "charging" | "body" | "lighting";
export type VehicleView = "exterior" | "interior";
export interface FeedbackCount {
  negative_records: number;
  total_records: number;
  negative_share: number | null;
  intensity_value: number;
  intensity_scale_id: string;
  low_evidence: boolean;
  provisional: boolean;
}
export interface PartFeedback {
  id: ComponentId;
  counts: FeedbackCount;
  cohort_ids?: string[];
}
export interface VehicleViewerProps {
  selectedComponent: ComponentId | null;
  onSelectComponent: (id: ComponentId) => void;
  view: VehicleView;
  onViewChange: (view: VehicleView) => void;
  heatmap: boolean;
  findings: PartFeedback[];
  className?: string;
  onStatusChange?: (status: "ready" | "fallback") => void;
}
