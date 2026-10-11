export const families = [
 {id:'F70', asset:'f70', name:'BMW 1 Series', label:'Your own direction', title:['ONE LIFE.','MANY DRIVES.'], description:'The city start. The long way home. Six ways to make the everyday your own.', count:6, person:'The independent driver'},
 {id:'G60', asset:'g60', name:'BMW 5 Series Sedan', label:'Every side of life', title:['EVERY DAY.','EVERY SIDE.'], description:'Business, family, a weekend away. Ten perspectives, from diesel and petrol to plug-in hybrid and electric i5.', count:10, person:'The everyday explorer'},
 {id:'G68', asset:'g68', name:'BMW 5 Series Long Wheelbase', label:'A little more room', title:['MORE ROOM.','MORE YOU.'], description:'A longer perspective on the 5 Series. The standard long-wheelbase model for the China dataset.', count:1, person:'The considered traveller'},
 {id:'G70', asset:'g70', name:'BMW 7 Series Sedan', label:'Space to arrive', title:['THE JOURNEY.','ELEVATED.'], description:'A place to drive. A place to unwind. Seven expressions of the 7 Series, including the electric i7.', count:7, person:'Every seat has a voice'},
];
const variants = {
 F70:['116','120','123 xDrive','M135 xDrive','118d','120d'],
 G60:['520i','520d','520d xDrive','540d xDrive','530e','530e xDrive','550e xDrive','i5 eDrive40','i5 xDrive40','i5 M60 xDrive'],
 G70:['740 xDrive','740d xDrive','750e xDrive','M760e xDrive','i7 50xDrive','i7 60xDrive','i7 M70 xDrive'],
 G68:['5 Series Long Wheelbase'],
};
const exteriorCodes = {
 F70:['31GE','81GE','61GE','21GE','11GF','21GF'],
 G60:['11FJ','11FL','21FL','31FL','71FJ','81FJ','11FK','61HG','31HG','41HG'],
 G70:['61HZ','21HZ','71HZ','81HZ','61HY','71HY','81HY'],
 G68:['g68'],
};
export const models = families.flatMap(f=>variants[f.id].map((trim,index)=>({
 id:`${f.id}-${trim.replaceAll(' ','-')}`, name:`BMW ${trim}`, trim, family:f.id,
 exterior:exteriorCodes[f.id][index],
 image:`/images/bmw/exterior/${exteriorCodes[f.id][index]}/${f.id==='G68'?'00':'04'}.webp`, theme:f.name,
 powertrain:f.id==='G68'?'China · Standard':trim.startsWith('i')?'Electric':/\d+e/.test(trim)?'Plug-in hybrid':trim.includes('d')?'Diesel':'Petrol',
 description:`${f.name} · ${trim}. ${f.description}`,
})));
export const chapters = families.map((f,i)=>({...f,model:models.find(m=>m.family===f.id).id,eyebrow:`0${i+1} / ${f.name}`,note:`Explore ${f.name}`}));
