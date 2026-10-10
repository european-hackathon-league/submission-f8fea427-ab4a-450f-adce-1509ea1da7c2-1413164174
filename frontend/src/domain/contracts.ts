export type ComponentId = 'steering' | 'dashboard' | 'seats' | 'charging' | 'body' | 'lighting';
export type VehicleView = 'exterior' | 'interior';
export type Period = '2025' | '2026';
export type Market = 'Europe' | 'China' | 'United States';
export interface Sample {negative:number; total:number}
export interface Evidence {id:string;quote:string;source:string;period:Period;market:Market;stance:'supports-friction'|'counter-signal'}
export interface Finding {id:ComponentId;name:string;category:VehicleView;summary:string;previous:Sample;current:Sample;trend:number[];evidence:Evidence[];marketSamples:Record<Market,Sample>;research:string;hypotheses:string[]}
export type Decision = 'Draft' | 'Approved' | 'Deferred' | 'Rejected';
export interface Requirement {id:string;version:number;title:string;componentId:ComponentId;priority:number|null;status:Decision;rationale:string;evidenceIds:string[]}
export interface VehicleViewerProps {selectedComponent:ComponentId;onSelectComponent:(id:ComponentId)=>void;view:VehicleView;onViewChange:(view:VehicleView)=>void;heatmap:boolean;period:Period;findings:Finding[];className?:string;modelUrl?:string;onStatusChange?:(status:'ready'|'fallback')=>void}
