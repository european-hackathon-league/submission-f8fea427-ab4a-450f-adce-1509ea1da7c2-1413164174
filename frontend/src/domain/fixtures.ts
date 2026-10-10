import type {Finding,Requirement,ComponentId,Market,Sample} from './contracts';
const rows: Array<[ComponentId,string,'interior'|'exterior',number,number,string,string]> = [
 ['steering','Steering-wheel controls','interior',68,25,'A clearer way to stay in control.','Customers report fewer accidental inputs, but discovering shortcuts remains a friction point.'],
 ['dashboard','Dashboard & display','interior',60,43,'Make everyday tasks effortless.','Drivers still need too many steps to reach frequently used comfort functions.'],
 ['seats','Seating & comfort','interior',34,18,'Comfort that feels intuitive.','Seat adjustment feedback has improved, with remaining concerns around memory settings.'],
 ['charging','Charging experience','exterior',51,38,'Confidence at every stop.','Charging status and compatibility remain unclear for some customers.'],
 ['body','Body & access','exterior',31,22,'Thoughtful details, every day.','Door access has improved; customers still mention trunk gesture reliability.'],
 ['lighting','Lighting & visibility','exterior',28,14,'Clarity after dark.','Fewer customers mention difficult lighting controls in the current feedback sample.'],
];
const quotes:Record<ComponentId,string[]>={
 steering:['I can change the volume without looking now. The buttons feel much clearer.','I still trigger the voice assistant when I mean to skip a track.','Finding the shortcut settings took me longer than expected.'],
 dashboard:['Changing the climate setting should not take several screens.','The display is beautiful, but I want my usual controls in one place.','The shortcut helped once someone showed me how to set it up.'],
 seats:['The seating position is easy to save now.','I would like the memory button to be easier to identify.','My passenger found the adjustments without asking me.'],
 charging:['I want to know immediately whether charging has actually started.','The connection worked, but the status messages were confusing.','Compatibility information would have saved me a wasted stop.'],
 body:['The door handles are easier to use than before.','The trunk gesture only works sometimes for me.','Loading bags is easier with the updated access settings.'],
 lighting:['The lights adjust well on dark roads.','I am unsure which mode I have selected.','The control is easier to find in the new layout.'],
};
export const findings:Finding[]=rows.map(([id,name,category,before,after,summary,research])=>({
 id,name,category,summary,previous:{negative:before*4,total:400},current:{negative:after*4,total:400},trend:[before,before-5,before-12,Math.round((before+after)/2),after+4,after],
 evidence:quotes[id].map((quote,i)=>({id:`${id}-E${i+1}`,quote,source:`Synthetic customer study · record ${i+1}`,period:i===2?'2025':'2026',market:'Europe'})),
 marketSamples:{Europe:{negative:after*4,total:400},China:{negative:Math.min(after+13,90)*2,total:200},'United States':{negative:Math.max(after-7,4)*2,total:200}},research,
 hypotheses:['Differences in feature discoverability may influence the feedback.','Equipment, software versions and sample composition may differ.','Matched usability studies are needed before claiming a causal explanation.']
}));
export const initialRequirements:Requirement[]=[
 {id:'REQ-001',version:1,title:'Make frequent steering-wheel actions easy to identify and operate without looking away.',componentId:'steering',priority:87,status:'Draft',rationale:'',evidenceIds:['steering-E1','steering-E2']},
 {id:'REQ-002',version:1,title:'Keep frequently used comfort controls reachable from the main display.',componentId:'dashboard',priority:92,status:'Draft',rationale:'',evidenceIds:['dashboard-E1','dashboard-E3']},
 {id:'REQ-003',version:1,title:'Make charging progress and connection status immediately understandable.',componentId:'charging',priority:81,status:'Draft',rationale:'',evidenceIds:['charging-E1','charging-E2']},
 {id:'REQ-004',version:1,title:'Help passengers find and save their preferred seating position.',componentId:'seats',priority:64,status:'Approved',rationale:'Demo decision: validate the memory-control labels with representative customers.',evidenceIds:['seats-E2']},
];
export const markets:Market[]=['Europe','China','United States'];
export function sampleFor(finding:Finding,period:'2025'|'2026',market:Market):Sample {
 // Only the Europe fixture has a longitudinal baseline. Never synthesize one for another market.
 return period==='2025' ? (market==='Europe'?finding.previous:{negative:0,total:0}) : finding.marketSamples[market];
}
