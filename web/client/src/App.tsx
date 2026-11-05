import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Activity, ArrowDownToLine, Box, Check, ChevronDown, ChevronRight, CircleHelp, Crosshair, Download, FilePlus2, FolderOpen, Grid2X2, Layers, MousePointer2, Move, Plus, Redo2, Ruler, Save, Search, Settings2, Square, Trash2, Undo2, Upload, ZoomIn, ZoomOut, Play, X, ChartNoAxesCombined, SlidersHorizontal, Compass, Droplets, AlertCircle, PanelLeftClose, Anchor, Scissors, CircleDot, ArrowDown } from 'lucide-react'
import schemaJson from '../../../docs/k2d.schema.json'

type Dict = Record<string, any>
type Point = [number, number]
const schema:Dict=schemaJson as Dict
const rawCorpusExamples=import.meta.glob('../../../tests/corpus/*.k2d',{eager:true,query:'?raw',import:'default'}) as Record<string,string>
const rawStudyExamples=import.meta.glob('../../../tests/studies/*.k2d',{eager:true,query:'?raw',import:'default'}) as Record<string,string>

const corpusExamples=Object.entries(rawCorpusExamples).sort(([a],[b])=>a.localeCompare(b)).map(([filename,raw])=>({filename,category:'Corpus Benchmarks',project:JSON.parse(raw) as Dict}))
const studyExamples=Object.entries(rawStudyExamples).sort(([a],[b])=>a.localeCompare(b)).map(([filename,raw])=>({
 filename,
 category:filename.includes('test-')?'Structural & Tunnel Cases':'Geotechnical Studies',
 project:JSON.parse(raw) as Dict
}))
const allPresets=[...studyExamples,...corpusExamples]

type Mesh = { node_count:number; element_count:number; nodes_per_element:number; x:number[]; y:number[]; connectivity:number[]; element_material:number[]; boundary_nodes:number[] }
type PhaseResult = Dict & { mesh:Mesh; displacement:number[]; stress:number[][]; pore:number[]; struct_forces:Dict[]; interface_forces:Dict[]; diagnostics:Dict[]; active?: number[] }
const modes = ['Soil','Structures','Mesh','Flow Conditions','Staged Construction']
const bands: Record<string,string[]> = {Soil:['Project properties','materials','polygons','strata','boreholes'],Structures:['structs','plates','anchors','geogrids','embedded','loads','disps'],Mesh:['Mesh settings'], 'Flow Conditions':['Groundwater','hydros'], 'Staged Construction':['initial','phases']}
const labels:Record<string,string>={materials:'Soil materials',polygons:'Soil polygons',strata:'Strata',boreholes:'Boreholes',structs:'Structures',plates:'Plate materials',anchors:'Anchor materials',geogrids:'Geogrid materials',embedded:'Embedded beam materials',loads:'Loads',disps:'Prescribed displacements',hydros:'Wells and drains',initial:'Initial phase',phases:'Calculation phases',mesh:'Mesh settings',project:'Project properties'}
const arrays=new Set(['materials','plates','anchors','geogrids','embedded','polygons','strata','boreholes','structs','loads','disps','hydros','phases'])
const defaults:Dict={katai2d:29,name:'Untitled project',axisymmetric:false,initial_procedure:0,x_min:0,x_max:20,y_min:0,y_max:10,has_water:false,wx:[],wy:[],mesh:{elem_size:1,order:6,auto_refine:true,corner_refine:true,grading:0.15,generator:'plaxis',preset:'Medium'},materials:[{name:'Sand',model:1,drainage:0,color:[0.91,0.78,0.48],gamma_unsat:17,gamma_sat:20,e_init:0.5,E:13000,nu:0.3,c:1,phi:30,psi:0,kx:1,ky:1}],plates:[],anchors:[],geogrids:[],embedded:[],strata:[],boreholes:[],polygons:[],structs:[],loads:[],disps:[],hydros:[],initial:{name:'Initial phase',type:0,duration:1,steps:25,design:0,seiswave:0,seisamp:1,seisfreq:2,damp:0.05,rayf1:1,rayf2:8,seisff:0,dynnl:0,seiscb:0,ec8on:0,ec8agr:.2,ec8gi:1,ec8gnd:2,ec8typ:0,tbdyss:1,tbdys1:.4,siteclass:2,poly:[],struct:[],load:[],disp:[],hydro:[],water_override:false,wx:[],wy:[]},phases:[]}
const tools = [{id:'select',title:'Select',icon:MousePointer2},{id:'pan',title:'Pan',icon:Move},{id:'monitor',title:'Monitor point',icon:Crosshair},{id:'polygon',title:'Soil polygon',icon:Layers},{id:'rectangle',title:'Rectangle',icon:Square},{id:'borehole',title:'Borehole',icon:Crosshair},{id:'structure',title:'Structure line',icon:Activity},{id:'load',title:'Distributed load',icon:ArrowDownToLine},{id:'disp',title:'Prescribed displacement',icon:Crosshair},{id:'hydro',title:'Well / drain',icon:Activity},{id:'water',title:'Water line',icon:Activity}]
const colors=['#8c6d35','#3d78a8','#894e91','#bf6b3d','#4c847b','#6672a7']
function clone<T>(x:T):T{return JSON.parse(JSON.stringify(x))}

function computeNodalStrains(mesh:Mesh, disp:number[]){
 const n=mesh.node_count;
 const exx=new Float64Array(n),eyy=new Float64Array(n),gxy=new Float64Array(n),weights=new Float64Array(n);
 const npe=mesh.nodes_per_element||3;
 for(let e=0;e<mesh.element_count;e++){
  const ids=mesh.connectivity.slice(e*npe,e*npe+3);
  if(ids.length<3)continue;
  const [i0,i1,i2]=ids;
  const x0=mesh.x[i0],y0=mesh.y[i0],x1=mesh.x[i1],y1=mesh.y[i1],x2=mesh.x[i2],y2=mesh.y[i2];
  const detJ=(x1-x0)*(y2-y0)-(x2-x0)*(y1-y0);
  if(Math.abs(detJ)<1e-12)continue;
  const area=0.5*Math.abs(detJ);
  const b0=y1-y2,c0=x2-x1,b1=y2-y0,c1=x0-x2,b2=y0-y1,c2=x1-x0;
  const u0=disp[i0*2]||0,v0=disp[i0*2+1]||0,u1=disp[i1*2]||0,v1=disp[i1*2+1]||0,u2=disp[i2*2]||0,v2=disp[i2*2+1]||0;
  const e_xx=(b0*u0+b1*u1+b2*u2)/detJ;
  const e_yy=(c0*v0+c1*v1+c2*v2)/detJ;
  const g_xy=(c0*u0+b0*v0+c1*u1+b1*v1+c2*u2+b2*v2)/detJ;
  for(let k=0;k<Math.min(npe,ids.length);k++){
   const idx=mesh.connectivity[e*npe+k];
   exx[idx]+=e_xx*area;eyy[idx]+=e_yy*area;gxy[idx]+=g_xy*area;weights[idx]+=area;
  }
 }
 const outExx=new Array(n),outEyy=new Array(n),outGxy=new Array(n),outEv=new Array(n),outEq=new Array(n);
 for(let i=0;i<n;i++){
  const w=weights[i]||1,xx=exx[i]/w,yy=eyy[i]/w,xy=gxy[i]/w;
  outExx[i]=xx*100;outEyy[i]=yy*100;outGxy[i]=xy*100;outEv[i]=(xx+yy)*100;
  outEq[i]=Math.sqrt((2/9)*((xx-yy)**2+yy**2+xx**2)+(1/3)*(xy**2))*100;
 }
 return {exx:outExx,eyy:outEyy,gxy:outGxy,ev:outEv,eq:outEq};
}

const outputGroups = [
 {
  name:'DEFORMATIONS',
  id:'deformations',
  icon:Activity,
  color:'#2563eb',
  fields:[
   'Total Displacement |u| [mm]',
   'Horizontal Displacement u_x [mm]',
   'Vertical Displacement u_y [mm]',
   'Displacement Increments |Δu| [mm]'
  ],
  toggleLabel:'Vektor Perpindahan',
  toggleKey:'arrows'
 },
 {
  name:'EFFECTIVE STRESSES',
  id:'effective-stresses',
  icon:SlidersHorizontal,
  color:'#059669',
  fields:[
   "Cartesian Effective Stress σ'_yy [kN/m²]",
   "Horizontal Effective Stress σ'_xx [kN/m²]",
   "Shear Stress σ_xy [kN/m²]",
   "Out-of-plane Stress σ'_zz [kN/m²]",
   "Major Principal Stress σ'_1 [kN/m²]",
   "Minor Principal Stress σ'_3 [kN/m²]",
   "Mean Effective Stress p' [kN/m²]",
   "Deviatoric Stress q [kN/m²]"
  ],
 },
 {
  name:'TOTAL STRAINS',
  id:'total-strains',
  icon:Compass,
  color:'#d97706',
  fields:[
   'Vertical Strain ε_yy [%]',
   'Horizontal Strain ε_xx [%]',
   'Shear Strain γ_xy [%]',
   'Volumetric Strain ε_v [%]',
   'Deviatoric Strain ε_q [%]'
  ],
 },
 {
  name:'PORE WATER PRESSURES',
  id:'pore-water-pressures',
  icon:Droplets,
  color:'#0891b2',
  fields:[
   'Steady State p_steady [kN/m²]',
   'Excess Pore Pressure p_excess [kN/m²]',
   'Active Pore Pressure p_active [kN/m²]'
  ],
 },
 {
  name:'FAILURE POINTS',
  id:'failure-points',
  icon:AlertCircle,
  color:'#dc2626',
  fields:[
   'Plastic Points (MC / Hardening / Tension Cut-off)'
  ]
 },
 {
  name:'STRUCTURE FORCES',
  id:'structure-forces',
  icon:Layers,
  color:'#dc2626',
  fields:[
   'Bending Moment M [kNm/m]',
   'Shear Force Q [kN/m]',
   'Axial Force N [kN/m]',
   'Structure Displacement |u| [mm]'
  ]
 }
];

function LiveMonitorChart({job,phaseIndex,project}:{job:Dict|null,phaseIndex?:number,project?:Dict}){
 const samples:Dict[]=job?.progress?.samples||[]
 const latest=samples.at(-1)

 const isRunning=Boolean(job&&['queued','running','cancelling'].includes(job.status))
 const targetPhase=isRunning?(latest?.phase_index??(phaseIndex??0)):(phaseIndex!==undefined?phaseIndex:(latest?.phase_index??0))
 const phaseSamples=samples.filter(s=>s.phase_index===targetPhase)
 const phaseLatest=phaseSamples.at(-1)||(latest?.phase_index===targetPhase?latest:null)
 const monitor=job?.progress?.monitor||phaseLatest||latest

 const phaseName=phaseLatest?.phase_name||(targetPhase===0?project?.initial?.name:project?.phases?.[targetPhase-1]?.name)||''
 const phaseType=targetPhase===0?(project?.initial_procedure===2?1:0):Number(project?.phases?.[targetPhase-1]?.type??0)
 const isSafety=Boolean(
  phaseType===1||
  phaseName.toLowerCase().includes('safety')||
  phaseName.toLowerCase().includes('phi-c')||
  phaseLatest?.is_safety
 )

 const width=360,height=220,left=48,right=20,top=18,bottom=44,plotW=width-left-right,plotH=height-top-bottom
 const firstDisp=Number(phaseSamples[0]?.displacement)||0
 const dispRel=(s:Dict)=>Math.max(0,(Number(s.displacement)||0)-firstDisp)
 const maxX=Math.max(1e-12,...phaseSamples.map(dispRel))*1.08

 const maxY=isSafety?Math.max(1.5,...phaseSamples.map(s=>Number(s.load_factor)||0))*1.05:1.0
 const yLabel=isSafety?'Safety Factor (SF)':'ΣM-Stage'

 const coords=(key:string,max:number)=>phaseSamples.map(s=>`${left+dispRel(s)/maxX*plotW},${top+plotH-(Number(s[key])||0)/max*plotH}`).join(' ')

 return <section className="live-monitor" data-sample-count={phaseSamples.length} aria-label="Live convergence monitor">
  <header><b>LIVE CONVERGENCE MONITOR</b><span>{phaseLatest?phaseLatest.phase_name:(job?.status||'Ready')}</span></header>
  <div className="monitor-node">{monitor?.node_index!=null?<>Node {Number(monitor.node_index)+1} · ({Number(monitor.x).toFixed(3)}, {Number(monitor.y).toFixed(3)}) m</>: 'Node resolves when the solver mesh is generated'}</div>
  <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${yLabel} by monitored displacement`}>
   {[0,.25,.5,.75,1].map((f,i)=><g key={i}><line x1={left} y1={top+plotH*(1-f)} x2={left+plotW} y2={top+plotH*(1-f)} stroke="#e3e9ed"/><text x={left-6} y={top+plotH*(1-f)+3} textAnchor="end">{(maxY*f).toFixed(2)}</text></g>)}
   <line x1={left} y1={top} x2={left} y2={top+plotH} stroke="#8495a1"/><line x1={left+plotW} y1={top} x2={left+plotW} y2={top+plotH} stroke="#8495a1"/><line x1={left} y1={top+plotH} x2={left+plotW} y2={top+plotH} stroke="#8495a1"/>
   {phaseSamples.length>0&&<><polyline points={coords('load_factor',maxY)} fill="none" stroke="#236f9c" strokeWidth="2.5"/>{phaseSamples.map((s,i)=><circle key={i} cx={left+dispRel(s)/maxX*plotW} cy={top+plotH-(Number(s.load_factor)||0)/maxY*plotH} r="2.2" fill="#236f9c"/>)}</>}
   <text x={left} y={height-23} className="axis-label">Monitored displacement (m)</text>
   <text x={left} y={12} className="load-label">{yLabel}</text>
  </svg>
  <div className="monitor-metrics-panel">
   <div className="metric-row"><span>2D effective stress magnitude:</span><strong>{phaseLatest?.sigma_magnitude!=null?Number(phaseLatest.sigma_magnitude).toFixed(2):'—'} kPa</strong></div>
   {isSafety?(
    <div className="metric-row sf-highlight"><span>Realtime Factor of Safety (SF):</span><strong>{phaseLatest?.load_factor!=null?Number(phaseLatest.load_factor).toFixed(3):'—'}</strong></div>
   ):(
    <div className="metric-row"><span>Current ΣM-Stage:</span><strong>{phaseLatest?.load_factor!=null?Number(phaseLatest.load_factor).toFixed(3):'0.000'} / 1.000</strong></div>
   )}
  </div>
  <div className="monitor-legend"><span><i className="load-dot"/>{yLabel}</span></div>
  <div className="monitor-current">{phaseLatest?<>Force residual <b>{Number(phaseLatest.force_error).toExponential(2)}</b> · <b>{phaseLatest.iterations}</b> iterations</>:'Waiting for committed mechanical increments'}</div>
 </section>
}
function fmt(s:string){return s.replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,m=>m.toUpperCase())}
function entitySchema(key:string){const map:Record<string,string>={materials:'material',plates:'plateMaterial',anchors:'anchorMaterial',geogrids:'geogridMaterial',embedded:'embeddedBeamMaterial',polygons:'soilPolygon',strata:'stratum',boreholes:'borehole',structs:'structElement',loads:'load',disps:'prescribedDisp',initial:'phase',phases:'phase'};return schema.$defs?.[map[key]]?.properties||schema.properties?.[key]?.items?.properties||{}}
function propsFor(p:Dict){if(p?.properties)return p.properties;const ref=String(p?.$ref||'').split('/').pop();return ref?schema.$defs?.[ref]?.properties||{}:{}}
function resolveProp(s:Dict={}){const ref=String(s.$ref||'').split('/').pop();return ref?{...(schema.$defs?.[ref]||{}),...s}:s}
function emptyEntity(key:string,project:Dict):Dict{
 const p=entitySchema(key),v:Dict={}
 for(const [k,raw] of Object.entries<any>(p)){
  const s=resolveProp(raw)
  if('default'in s)v[k]=clone(s.default)
  else if(s.type==='string')v[k]=k==='name'?`${fmt(key)} ${((project[key]||[]).length)+1}`:''
  else if(s.type==='boolean')v[k]=false
  else if(s.type==='array')v[k]=[]
  else if(s.type==='object')v[k]={}
  else if(s.type==='integer'||s.type==='number')v[k]=s.enum?.[0]??0
 }
 if(key==='phases'){
  const prevPhase=(project.phases&&project.phases.length>0)
   ? project.phases[project.phases.length-1]
   : project.initial
  v.duration=1
  v.steps=25
  v.mstage=1
  const polyLen=project.polygons?.length||0
  const structLen=project.structs?.length||0
  const loadLen=project.loads?.length||0
  const dispLen=project.disps?.length||0
  const hydroLen=project.hydros?.length||0

  if(prevPhase){
   if(prevPhase.poly?.length)v.poly=clone(prevPhase.poly)
   else v.poly=Array.from({length:polyLen},()=>1)

   if(prevPhase.struct?.length)v.struct=clone(prevPhase.struct)
   else v.struct=Array.from({length:structLen},()=>1)

   if(prevPhase.load?.length)v.load=clone(prevPhase.load)
   else v.load=Array.from({length:loadLen},()=>1)

   if(prevPhase.disp?.length)v.disp=clone(prevPhase.disp)
   else v.disp=Array.from({length:dispLen},()=>0)

   if(prevPhase.hydro?.length)v.hydro=clone(prevPhase.hydro)
   else v.hydro=Array.from({length:hydroLen},()=>0)

   if(prevPhase.water_override!==undefined)v.water_override=prevPhase.water_override
   if(prevPhase.wx)v.wx=clone(prevPhase.wx)
   if(prevPhase.wy)v.wy=clone(prevPhase.wy)
  }else{
   v.poly=Array.from({length:polyLen},()=>1)
   v.struct=Array.from({length:structLen},()=>1)
   v.load=Array.from({length:loadLen},()=>1)
   v.disp=Array.from({length:dispLen},()=>0)
   v.hydro=Array.from({length:hydroLen},()=>0)
  }
  while(v.poly.length<polyLen)v.poly.push(1)
  while(v.struct.length<structLen)v.struct.push(1)
  while(v.load.length<loadLen)v.load.push(1)
  while(v.disp.length<dispLen)v.disp.push(0)
  while(v.hydro.length<hydroLen)v.hydro.push(0)
 }
 return v
}

function PolygonEdgeEditor({poly,onChange}:{poly:Dict,onChange:(p:Dict)=>void}){
 const n=poly.x?.length||0
 if(n<3)return null
 const edgeBc=Array.from({length:n},(_,i)=>Number(poly.edge_bc?.[i]??0))
 const edgeFlow=Array.from({length:n},(_,i)=>Number(poly.edge_flow?.[i]??0))
 const edgeHead=Array.from({length:n},(_,i)=>Number(poly.edge_head?.[i]??0))
 const edgeFlux=Array.from({length:n},(_,i)=>Number(poly.edge_flux?.[i]??0))

 const update=(i:number,field:string,val:number)=>{
  const next={...poly}
  if(field==='bc'){const arr=[...edgeBc];arr[i]=val;next.edge_bc=arr}
  else if(field==='flow'){const arr=[...edgeFlow];arr[i]=val;next.edge_flow=arr}
  else if(field==='head'){const arr=[...edgeHead];arr[i]=val;next.edge_head=arr}
  else if(field==='flux'){const arr=[...edgeFlux];arr[i]=val;next.edge_flux=arr}
  onChange(next)
 }
 const bcOpts=[[0,'0 · Free'],[1,'1 · Normally fixed (roller)'],[2,'2 · Horizontally fixed'],[3,'3 · Vertically fixed'],[4,'4 · Fully fixed']]
 const flowOpts=[[0,'0 · Closed (impermeable)'],[1,'1 · Prescribed head'],[2,'2 · Seepage face'],[3,'3 · Prescribed flux']]

 return <div className="edge-bc-editor">
  <b>Edge Boundary Conditions</b>
  <small className="muted">Configure mechanical and seepage BCs for each boundary edge.</small>
  <div className="edge-list">
   {Array.from({length:n},(_,i)=>{
    const next=(i+1)%n
    return <div key={i} className="edge-item">
     <span className="edge-title">Edge {i+1}: ({poly.x[i]}, {poly.y[i]}) → ({poly.x[next]}, {poly.y[next]})</span>
     <div className="edge-fields">
      <label><span>Mechanical BC</span><select value={edgeBc[i]} onChange={e=>update(i,'bc',Number(e.target.value))}>{bcOpts.map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
      <label><span>Flow BC</span><select value={edgeFlow[i]} onChange={e=>update(i,'flow',Number(e.target.value))}>{flowOpts.map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
      {edgeFlow[i]===1&&<label><span>Prescribed Head (m)</span><input type="number" step="any" value={edgeHead[i]} onChange={e=>update(i,'head',Number(e.target.value))}/></label>}
      {edgeFlow[i]===3&&<label><span>Prescribed Flux (m/day)</span><input type="number" step="any" value={edgeFlux[i]} onChange={e=>update(i,'flux',Number(e.target.value))}/></label>}
     </div>
    </div>
   })}
  </div>
 </div>
}

function SoilMaterialEditor({mat,onChange}:{mat:Dict;onChange:(m:Dict)=>void}){
 const model=Number(mat.model??1)
 const drainage=Number(mat.drainage??0)
 const update=(key:string,val:any)=>onChange({...mat,[key]:val})

 const num=(label:string,key:string,val:any,step:string='any',placeholder:string='')=>(
  <label className="field" key={key}>
   <span>{label}</span>
   <input type="number" step={step} value={val??''} placeholder={placeholder} onChange={e=>update(key,e.target.value===''?0:Number(e.target.value))}/>
  </label>
 )

 const check=(label:string,key:string,val:boolean)=>(
  <label className="checkfield" key={key}>
   <input type="checkbox" checked={!!val} onChange={e=>update(key,e.target.checked)}/>
   <span>{label}</span>
  </label>
 )

 const modelOptions:[number,string][]=[
  [0,'Linear Elastic (LE)'],
  [1,'Mohr-Coulomb (MC)'],
  [2,'Hardening Soil (HS)'],
  [3,'HS-Small (HSS)'],
  [4,'Soft Soil (SS)'],
  [5,'Soft Soil Creep (SSC)'],
  [6,'Hoek-Brown (HB)'],
  [7,'Modified Cam-Clay (MCC)'],
  [8,'NGI-ADP Anisotropic'],
  [9,'Jointed Rock (JR)'],
 ]

 const drainageOptions:[number,string][]=[
  [0,'Drained'],
  [1,'Undrained (A)'],
  [2,'Non-porous'],
  [3,'Undrained (B)'],
  [4,'Undrained (C)'],
 ]

 const activeModelName=String(modelOptions.find(([v])=>v===model)?.[1]||'Mohr-Coulomb (MC)')

 return <div className="material-editor">
  <div className="property-group">
   <div className="property-group-head">
    <span>General properties</span>
    <span className="property-badge">{activeModelName.split(' ')[0]}</span>
   </div>
   <label className="field">
    <span>Name</span>
    <input type="text" value={mat.name||''} onChange={e=>update('name',e.target.value)}/>
   </label>
   <label className="field">
    <span>Model</span>
    <select value={model} onChange={e=>update('model',Number(e.target.value))}>
     {modelOptions.map(([v,t])=><option key={v} value={v}>{v} · {t}</option>)}
    </select>
   </label>
   <label className="field">
    <span>Drainage</span>
    <select value={drainage} onChange={e=>update('drainage',Number(e.target.value))}>
     {drainageOptions.map(([v,t])=><option key={v} value={v}>{v} · {t}</option>)}
    </select>
   </label>
   <label className="field">
    <span>Color</span>
    <input type="text" value={Array.isArray(mat.color)?mat.color.join(', '):(mat.color||'0.85, 0.78, 0.55')} onChange={e=>{
     const val=e.target.value
     if(val.includes(','))update('color',val.split(',').map(x=>x.trim()).filter(Boolean).map(Number))
     else update('color',val)
    }}/>
   </label>
   {num('Gamma unsat','gamma_unsat',mat.gamma_unsat??17,'any','kN/m³')}
   {num('Gamma sat','gamma_sat',mat.gamma_sat??20,'any','kN/m³')}
   {num('Kx','kx',mat.kx??1,'any','m/day')}
   {num('Ky','ky',mat.ky??1,'any','m/day')}
   {num('E init','e_init',mat.e_init??0.5,'any','initial void ratio')}
  </div>

  <div className="property-group">
   <div className="property-group-head">
    <span>Constitutive parameters ({activeModelName})</span>
   </div>

   {model===0&&<>
    {num('E','E',mat.E??100000,'any','kPa')}
    {num('Nu','nu',mat.nu??0.3,'any','-')}
   </>}

   {model===1&&<>
    {num('E','E',mat.E??13000,'any','kPa')}
    {num('Nu','nu',mat.nu??0.3,'any','-')}
    {num('C','c',mat.c??1,'any','kPa')}
    {num('Phi','phi',mat.phi??30,'any','°')}
    {num('Psi','psi',mat.psi??0,'any','°')}
    <details className="nested" open>
     <summary>Advanced stiffness & strength</summary>
     {num('E inc','E_inc',mat.E_inc,'any','kPa/m')}
     {num('Y ref','y_ref',mat.y_ref,'any','m')}
     {num('C inc','c_inc',mat.c_inc,'any','kPa/m')}
     {check('Tension cutoff','tension_cutoff',mat.tension_cutoff??true)}
     {num('Tensile strength','tensile_strength',mat.tensile_strength,'any','kPa')}
     {check('Dilatancy cutoff','dilatancy_cutoff',mat.dilatancy_cutoff??false)}
     {num('E max','e_max',mat.e_max,'any','-')}
    </details>
   </>}

   {model===2&&<>
    {num('E50ref','E50ref',mat.E50ref??30000,'any','kPa')}
    {num('Eoedref','Eoedref',mat.Eoedref??30000,'any','kPa')}
    {num('Eurref','Eurref',mat.Eurref??90000,'any','kPa')}
    {num('M','m',mat.m??0.5,'any','power')}
    {num('P ref','p_ref',mat.p_ref??100,'any','kPa')}
    {num('Nu ur','nu_ur',mat.nu_ur??0.2,'any','-')}
    {num('Rf','Rf',mat.Rf??0.9,'any','-')}
    {num('C','c',mat.c??1,'any','kPa')}
    {num('Phi','phi',mat.phi??30,'any','°')}
    {num('Psi','psi',mat.psi??0,'any','°')}
    {check('K0nc auto','k0nc_auto',mat.k0nc_auto??true)}
    {num('K0nc','k0nc',mat.k0nc??0.5,'any','-')}
    {check('Tension cutoff','tension_cutoff',mat.tension_cutoff??true)}
    {num('Tensile strength','tensile_strength',mat.tensile_strength??0,'any','kPa')}
   </>}

   {model===3&&<>
    {num('E50ref','E50ref',mat.E50ref??30000,'any','kPa')}
    {num('Eoedref','Eoedref',mat.Eoedref??30000,'any','kPa')}
    {num('Eurref','Eurref',mat.Eurref??90000,'any','kPa')}
    {num('M','m',mat.m??0.5,'any','power')}
    {num('P ref','p_ref',mat.p_ref??100,'any','kPa')}
    {num('Nu ur','nu_ur',mat.nu_ur??0.2,'any','-')}
    {num('Rf','Rf',mat.Rf??0.9,'any','-')}
    {num('G0ref','G0ref',mat.G0ref??120000,'any','kPa')}
    {num('Gamma07','gamma07',mat.gamma07??0.00015,'any','-')}
    {num('C','c',mat.c??1,'any','kPa')}
    {num('Phi','phi',mat.phi??30,'any','°')}
    {num('Psi','psi',mat.psi??0,'any','°')}
    {check('K0nc auto','k0nc_auto',mat.k0nc_auto??true)}
    {num('K0nc','k0nc',mat.k0nc??0.5,'any','-')}
    {check('Tension cutoff','tension_cutoff',mat.tension_cutoff??true)}
    {num('Tensile strength','tensile_strength',mat.tensile_strength??0,'any','kPa')}
   </>}

   {model===4&&<>
    {num('Lamstar','lamstar',mat.lamstar??0.1,'any','λ*')}
    {num('Kapstar','kapstar',mat.kapstar??0.02,'any','κ*')}
    {num('Nu ur','nu_ur',mat.nu_ur??0.2,'any','-')}
    {num('C','c',mat.c??1,'any','kPa')}
    {num('Phi','phi',mat.phi??25,'any','°')}
    {num('Psi','psi',mat.psi??0,'any','°')}
    {check('Tension cutoff','tension_cutoff',mat.tension_cutoff??true)}
    {num('Tensile strength','tensile_strength',mat.tensile_strength??0,'any','kPa')}
   </>}

   {model===5&&<>
    {num('Lamstar','lamstar',mat.lamstar??0.1,'any','λ*')}
    {num('Kapstar','kapstar',mat.kapstar??0.02,'any','κ*')}
    {num('Mustar','mustar',mat.mustar??0.005,'any','μ*')}
    {num('Nu ur','nu_ur',mat.nu_ur??0.2,'any','-')}
    {num('C','c',mat.c??1,'any','kPa')}
    {num('Phi','phi',mat.phi??25,'any','°')}
    {num('Psi','psi',mat.psi??0,'any','°')}
    {check('Tension cutoff','tension_cutoff',mat.tension_cutoff??true)}
    {num('Tensile strength','tensile_strength',mat.tensile_strength??0,'any','kPa')}
   </>}

   {model===6&&<>
    {num('Sigci','sigci',mat.sigci??25000,'any','kPa')}
    {num('Mi','mi',mat.mi??10,'any','-')}
    {num('Gsi','gsi',mat.gsi??50,'any','0..100')}
    {num('Hb D','hbD',mat.hbD??0,'any','0..1')}
    {num('Sigpsi','sigpsi',mat.sigpsi??0,'any','°')}
    {num('E','E',mat.E??1000000,'any','kPa')}
    {num('Nu','nu',mat.nu??0.25,'any','-')}
   </>}

   {model===7&&<>
    {num('Lamstar','lamstar',mat.lamstar??0.15,'any','λ')}
    {num('Kapstar','kapstar',mat.kapstar??0.03,'any','κ')}
    {num('Nu','nu',mat.nu??0.3,'any','-')}
    {num('Phi','phi',mat.phi??28,'any','° (or M)')}
   </>}

   {model===8&&<>
    {num('Adpsu P','adpsuP',mat.adpsuP??0.33,'any','suP / suA')}
    {num('Adpsu DSS','adpsuDSS',mat.adpsuDSS??0.65,'any','suDSS / suA')}
    {num('Adpgf C','adpgfC',mat.adpgfC??0.01,'any','γf,C')}
    {num('Adpgf E','adpgfE',mat.adpgfE??0.03,'any','γf,E')}
    {num('Adpgf DSS','adpgfDSS',mat.adpgfDSS??0.02,'any','γf,DSS')}
    {num('E','E',mat.E??50000,'any','kPa')}
    {num('Nu','nu',mat.nu??0.49,'any','-')}
   </>}

   {model===9&&<>
    {num('E','E',mat.E??500000,'any','kPa')}
    {num('Nu','nu',mat.nu??0.25,'any','-')}
    {check('Jraniso','jraniso',mat.jraniso??false)}
    {mat.jraniso&&<div className="subfield-group">
     {num('Jr E2','jrE2',mat.jrE2??250000,'any','kPa')}
     {num('Jr nu2','jrnu2',mat.jrnu2??0.2,'any','-')}
     {num('Jr G2','jrG2',mat.jrG2??100000,'any','kPa')}
    </div>}
    {num('Jrsets','jrsets',mat.jrsets??1,'1','1..3')}
    {num('Jralpha1','jralpha1',mat.jralpha1??0,'any','dip angle 1 (°)')}
    {num('C','c',mat.c??10,'any','c1 (kPa)')}
    {num('Phi','phi',mat.phi??30,'any','φ1 (°)')}
    {num('Psi','psi',mat.psi??0,'any','ψ1 (°)')}
    {(mat.jrsets??1)>=2&&<div className="subfield-group">
     {num('Jralpha2','jralpha2',mat.jralpha2??45,'any','dip angle 2 (°)')}
     {num('Jrc2','jrc2',mat.jrc2??10,'any','c2 (kPa)')}
     {num('Jrphi2','jrphi2',mat.jrphi2??30,'any','φ2 (°)')}
     {num('Jrpsi2','jrpsi2',mat.jrpsi2??0,'any','ψ2 (°)')}
    </div>}
    {(mat.jrsets??1)>=3&&<div className="subfield-group">
     {num('Jralpha3','jralpha3',mat.jralpha3??90,'any','dip angle 3 (°)')}
     {num('Jrc3','jrc3',mat.jrc3??10,'any','c3 (kPa)')}
     {num('Jrphi3','jrphi3',mat.jrphi3??30,'any','φ3 (°)')}
     {num('Jrpsi3','jrpsi3',mat.jrpsi3??0,'any','ψ3 (°)')}
    </div>}
   </>}
  </div>

  <details className="nested" open>
   <summary>Interfaces & Initial stress (K0 / OCR)</summary>
   {check('Rinter rigid','rinter_rigid',mat.rinter_rigid??true)}
   {num('Rinter','Rinter',mat.Rinter,'any','1')}
   {check('K0 auto','k0_auto',mat.k0_auto??true)}
   {num('K0','k0',mat.k0,'any','0.5')}
   <label className="field">
    <span>Oc mode</span>
    <select value={mat.oc_mode??0} onChange={e=>update('oc_mode',Number(e.target.value))}>
     <option value={0}>0 · None</option>
     <option value={1}>1 · OCR</option>
     <option value={2}>2 · POP</option>
    </select>
   </label>
   {num('OCR','OCR',mat.OCR,'any','1')}
   {num('POP','POP',mat.POP,'any','0')}
  </details>

  <details className="nested" open>
   <summary>Groundwater & Undrained parameters</summary>
   {num('Nu u','nu_u',mat.nu_u,'any','0.495')}
   {num('Skempton B','skempton_B',mat.skempton_B,'any','0.99')}
   {num('Und mode','und_mode',mat.und_mode,'1','0=Standard, 1=Effective')}
   {num('Gw ga','gw_ga',mat.gw_ga,'any','0.01')}
   {num('Gw gl','gw_gl',mat.gw_gl,'any','0.5')}
   {num('Gw gn','gw_gn',mat.gw_gn,'any','1.5')}
   {num('Gw Sres','gw_Sres',mat.gw_Sres,'any','0.01')}
  </details>

  {(()=>{
   const generalKeys=new Set([
    'name','model','drainage','color','gamma_unsat','gamma_sat','kx','ky','e_init',
    'rinter_rigid','Rinter','k0_auto','k0','oc_mode','OCR','POP',
    'nu_u','skempton_B','und_mode','gw_ga','gw_gl','gw_gn','gw_Sres'
   ])
   const modelKeys:Record<number,string[]>={
    0:['E','nu'],
    1:['E','nu','c','phi','psi','E_inc','y_ref','c_inc','tension_cutoff','tensile_strength','dilatancy_cutoff','e_max'],
    2:['E50ref','Eoedref','Eurref','m','p_ref','nu_ur','Rf','c','phi','psi','k0nc_auto','k0nc','tension_cutoff','tensile_strength'],
    3:['E50ref','Eoedref','Eurref','m','p_ref','nu_ur','Rf','G0ref','gamma07','c','phi','psi','k0nc_auto','k0nc','tension_cutoff','tensile_strength'],
    4:['lamstar','kapstar','nu_ur','c','phi','psi','tension_cutoff','tensile_strength'],
    5:['lamstar','kapstar','mustar','nu_ur','c','phi','psi','tension_cutoff','tensile_strength'],
    6:['sigci','mi','gsi','hbD','sigpsi','E','nu'],
    7:['lamstar','kapstar','nu','phi'],
    8:['adpsuP','adpsuDSS','adpgfC','adpgfE','adpgfDSS','E','nu'],
    9:['E','nu','jraniso','jrE2','jrnu2','jrG2','jrsets','jralpha1','c','phi','psi','jralpha2','jrc2','jrphi2','jrpsi2','jralpha3','jrc3','jrphi3','jrpsi3'],
   }
   const allSchemaKeys=[
    'E','nu','c','phi','psi','E_inc','c_inc','y_ref',
    'tension_cutoff','tensile_strength','dilatancy_cutoff','e_max',
    'E50ref','Eoedref','Eurref','m','p_ref','nu_ur','Rf','G0ref','gamma07',
    'k0nc_auto','k0nc','lamstar','kapstar','mustar',
    'sigci','mi','gsi','hbD','sigpsi',
    'adpsuP','adpsuDSS','adpgfC','adpgfE','adpgfDSS',
    'jraniso','jrE2','jrnu2','jrG2','jrsets','jralpha1','jralpha2','jrc2','jrphi2','jrpsi2','jralpha3','jrc3','jrphi3','jrpsi3'
   ]
   const activeKeys=new Set([...generalKeys,...(modelKeys[model]||[])])
   const unhandled=allSchemaKeys.filter(k=>!activeKeys.has(k))
   if(!unhandled.length)return null
   return <details className="nested" open>
    <summary>Parameter Lanjutan Lainnya (Schema)</summary>
    {unhandled.map(k=>{
     const isBool=['tension_cutoff','dilatancy_cutoff','k0nc_auto','jraniso'].includes(k)
     if(isBool)return check(fmt(k),k,mat[k]??false)
     return num(fmt(k),k,mat[k],'any')
    })}
   </details>
  })()}
 </div>
}

function StagePhaseEditor({
 isInitial,
 phase,
 project,
 initialProc=0,
 onInitialProcChange,
 onChange,
}:{
 isInitial:boolean
 phase:Dict
 project:Dict
 initialProc?:number
 onInitialProcChange?:(proc:number)=>void
 onChange:(p:Dict)=>void
}){
 const type=Number(phase.type??0)
 const update=(key:string,val:any)=>onChange({...phase,[key]:val})

 const num=(label:string,key:string,val:any,step:string='any',placeholder:string='')=>(
  <label className="field" key={key}>
   <span>{label}</span>
   <input type="number" step={step} value={val??''} placeholder={placeholder} onChange={e=>update(key,e.target.value===''?0:Number(e.target.value))}/>
  </label>
 )

 const check=(label:string,key:string,val:boolean)=>(
  <label className="checkfield" key={key}>
   <input type="checkbox" checked={!!val} onChange={e=>update(key,e.target.checked)}/>
   <span>{label}</span>
  </label>
 )

 const arr=(label:string,key:string,arrVal:any[])=>{
  const val=Array.isArray(arrVal)?arrVal.join(', '):(arrVal??'')
  return <label className="field" key={key}>
   <span>{label}</span>
   <input type="text" value={val} onChange={e=>{
    const parsed=e.target.value.split(',').map(x=>x.trim()).filter(Boolean).map(Number)
    update(key,parsed)
   }} placeholder="comma separated (e.g. 1, 0)"/>
  </label>
 }

 const toggleActivation=(arrayKey:string,index:number,totalCount:number)=>{
  const defaultVal=['disp','hydro'].includes(arrayKey)?0:1
  const current=[...(phase[arrayKey]||[])]
  while(current.length<totalCount)current.push(defaultVal)
  current[index]=current[index]?0:1
  update(arrayKey,current)
 }

 const designOptions:[number,string][]=[
  [0,'None (characteristic)'],
  [1,'Eurocode 7 - DA1 Comb. 1'],
  [2,'Eurocode 7 - DA1 Comb. 2'],
  [3,'Eurocode 7 - DA2'],
  [4,'Eurocode 7 - DA3'],
  [5,'TBDY 2018 (Static)'],
  [6,'TBDY 2018 (Seismic)'],
 ]

 const stageTypeOptions:[number,string][]=[
  [0,'Plastic Stage'],
  [1,'Safety (Phi-c reduction)'],
  [2,'Consolidation'],
  [3,'Transient flow'],
  [4,'Fully coupled flow-deformation'],
  [5,'Dynamic (Seismic / Earthquake)'],
 ]

 const initialProcOptions:[number,string][]=[
  [0,'K0 Procedure (Jaky / Explicit)'],
  [1,'Gravity Loading'],
  [2,'Direct Safety (Phi-c Reduction)'],
  [3,'Groundwater Flow Only'],
 ]

 const polygons=project.polygons||[]
 const loads=project.loads||[]
 const structs=project.structs||[]
 const disps=project.disps||[]
 const hydros=project.hydros||[]

 return <div className="stage-inspector">
  <div className="property-group">
   <div className="property-group-head">
    <span>General parameters</span>
    <span className="property-badge">{isInitial?'Initial':stageTypeOptions.find(([v])=>v===type)?.[1]?.split(' ')?.[0]||'Plastic'}</span>
   </div>
   {isInitial?(
    <>
     <label className="field">
      <span>Initial procedure</span>
      <select value={initialProc} onChange={e=>onInitialProcChange?.(Number(e.target.value))}>
       {initialProcOptions.map(([v,t])=><option key={v} value={v}>{v} · {t}</option>)}
      </select>
     </label>
     <label className="field">
      <span>Name</span>
      <input type="text" value={phase.name||'Initial phase'} onChange={e=>update('name',e.target.value)}/>
     </label>
     {num('Steps','steps',phase.steps??25,'1')}
     {num('Duration','duration',phase.duration??1,'any','days')}
    </>
   ):(
    <>
     <label className="field">
      <span>Name</span>
      <input type="text" value={phase.name||''} placeholder="Phase name..." onChange={e=>update('name',e.target.value)}/>
     </label>
     <label className="field">
      <span>Type</span>
      <select value={type} onChange={e=>update('type',Number(e.target.value))}>
       {stageTypeOptions.map(([v,t])=><option key={v} value={v}>{v} · {t}</option>)}
      </select>
     </label>
     {num('Steps','steps',phase.steps??25,'1')}
     {num('Duration','duration',phase.duration??1,'any','days')}
    </>
   )}
  </div>

  <details className="nested" open>
   <summary>Soil polygons</summary>
   {arr('Poly','poly',phase.poly||[])}
   {polygons.length>0&&<div className="subfield-group">
    {polygons.map((p:Dict,i:number)=>{
     const isChecked=phase.poly&&i<phase.poly.length?Boolean(phase.poly[i]):true
     return <label className="checkfield draggable-item" key={i} draggable onDragStart={e=>{e.dataTransfer.setData('text/katai-stage-poly',String(i));e.dataTransfer.setData('text/plain',p.name||`Polygon ${i+1}`)}} title="Drag onto canvas to toggle active/inactive">
      <input type="checkbox" checked={isChecked} onChange={()=>toggleActivation('poly',i,polygons.length)}/>
      <span>{p.name||`Polygon ${i+1}`}</span>
     </label>
    })}
   </div>}
  </details>

  <details className="nested" open>
   <summary>External loads</summary>
   {arr('Load','load',phase.load||[])}
   {loads.length>0&&<div className="subfield-group">
    {loads.map((l:Dict,i:number)=>{
     const isChecked=phase.load&&i<phase.load.length?Boolean(phase.load[i]):true
     return <label className="checkfield draggable-item" key={i} draggable onDragStart={e=>{e.dataTransfer.setData('text/katai-stage-load',String(i));e.dataTransfer.setData('text/plain',l.name||`Load ${i+1}`)}} title="Drag onto canvas to toggle active/inactive">
      <input type="checkbox" checked={isChecked} onChange={()=>toggleActivation('load',i,loads.length)}/>
      <span>{l.name||`Load ${i+1}`}</span>
     </label>
    })}
   </div>}
  </details>

  <details className="nested" open>
   <summary>Structures</summary>
   {arr('Struct','struct',phase.struct||[])}
   {structs.length>0&&<div className="subfield-group">
    {structs.map((s:Dict,i:number)=>{
     const isChecked=phase.struct&&i<phase.struct.length?Boolean(phase.struct[i]):true
     return <label className="checkfield draggable-item" key={i} draggable onDragStart={e=>{e.dataTransfer.setData('text/katai-stage-struct',String(i));e.dataTransfer.setData('text/plain',s.name||`Structure ${i+1}`)}} title="Drag onto canvas to toggle active/inactive">
      <input type="checkbox" checked={isChecked} onChange={()=>toggleActivation('struct',i,structs.length)}/>
      <span>{s.name||`Structure ${i+1}`}</span>
     </label>
    })}
   </div>}
  </details>

  <details className="nested" open>
   <summary>Prescribed displacements</summary>
   {arr('Disp','disp',phase.disp||[])}
   {disps.length>0&&<div className="subfield-group">
    {disps.map((d:Dict,i:number)=>{
     const isChecked=phase.disp&&i<phase.disp.length?Boolean(phase.disp[i]):false
     return <label className="checkfield" key={i}>
      <input type="checkbox" checked={isChecked} onChange={()=>toggleActivation('disp',i,disps.length)}/>
      <span>{d.name||`Displacement ${i+1}`}</span>
     </label>
    })}
   </div>}
  </details>

  <details className="nested" open>
   <summary>Groundwater & wells</summary>
   {arr('Hydro','hydro',phase.hydro||[])}
   {hydros.length>0&&<div className="subfield-group">
    {hydros.map((h:Dict,i:number)=>{
     const isChecked=phase.hydro&&i<phase.hydro.length?Boolean(phase.hydro[i]):false
     return <label className="checkfield" key={i}>
      <input type="checkbox" checked={isChecked} onChange={()=>toggleActivation('hydro',i,hydros.length)}/>
      <span>{h.name||`Well/Drain ${i+1}`}</span>
     </label>
    })}
   </div>}
   {arr('Wx','wx',phase.wx||[])}
   {arr('Wy','wy',phase.wy||[])}
   {check('Water override','water_override',phase.water_override??false)}
  </details>

  <details className="nested" open>
   <summary>Calculation parameters</summary>
   <label className="field">
    <span>Design</span>
    <select value={phase.design??0} onChange={e=>update('design',Number(e.target.value))}>
     {designOptions.map(([v,t])=><option key={v} value={v}>{v} · {t}</option>)}
    </select>
   </label>
   {check('Water override','water_override',phase.water_override??false)}

   {isInitial?(
    <>
     {num('Type','type',phase.type??0,'1')}
    </>
   ):(
    <>
     {type===0&&<>
      {num('Mstage','mstage',phase.mstage??1,'any','stage multiplier')}
      {num('Tol','tol',phase.tol??0.01,'any')}
      {num('Maxiter','maxiter',phase.maxiter??60,'1')}
      {check('Reset disp','resetdisp',phase.resetdisp??false)}
      {check('Ignore und','ignoreund',phase.ignoreund??false)}
      {check('Reset small','resetsmall',phase.resetsmall??false)}
      <details className="nested" open>
       <summary>Pseudo-static seismic & flow coupling</summary>
       {num('Kh','kh',phase.kh??0,'any','horizontal coeff')}
       {num('Kv','kv',phase.kv??0,'any','vertical coeff')}
       {check('Flowpore','flowpore',phase.flowpore??false)}
      </details>
     </>}

     {type===1&&<>
      {num('Tol','tol',phase.tol??0.01,'any')}
      {num('Maxiter','maxiter',phase.maxiter??60,'1')}
      {check('Reset disp','resetdisp',phase.resetdisp??false)}
     </>}

     {type===2&&<>
      <label className="field">
       <span>Cstop</span>
       <select value={phase.cstop??0} onChange={e=>update('cstop',Number(e.target.value))}>
        <option value={0}>0 · Time interval</option>
        <option value={1}>1 · Minimum excess pore pressure</option>
        <option value={2}>2 · Degree of consolidation</option>
       </select>
      </label>
      {phase.cstop===1&&num('Cminp','cminp',phase.cminp??1,'any','kPa')}
      {phase.cstop===2&&num('Cdeg','cdeg',phase.cdeg??90,'any','%')}
      {num('Cfirst','cfirst',phase.cfirst??0,'any','first step (0 = auto)')}
      {num('Cmaxstep','cmaxstep',phase.cmaxstep??1000,'1')}
      {num('Tol','tol',phase.tol??0.01,'any')}
      {num('Maxiter','maxiter',phase.maxiter??60,'1')}
      {check('Water override','water_override',phase.water_override??false)}
      {check('Flowpore','flowpore',phase.flowpore??false)}
     </>}

     {type===3&&<>
      {check('Head ramp','headramp',phase.headramp??false)}
      {check('Water override','water_override',phase.water_override??false)}
     </>}

     {type===4&&<>
      <label className="field">
       <span>Cstop</span>
       <select value={phase.cstop??0} onChange={e=>update('cstop',Number(e.target.value))}>
        <option value={0}>0 · Time interval</option>
        <option value={1}>1 · Minimum excess pore pressure</option>
        <option value={2}>2 · Degree of consolidation</option>
       </select>
      </label>
      {phase.cstop===1&&num('Cminp','cminp',phase.cminp??1,'any','kPa')}
      {phase.cstop===2&&num('Cdeg','cdeg',phase.cdeg??90,'any','%')}
      {num('Tol','tol',phase.tol??0.01,'any')}
      {num('Maxiter','maxiter',phase.maxiter??60,'1')}
      {check('Water override','water_override',phase.water_override??false)}
     </>}

     {type===5&&<>
      <label className="field">
       <span>Seiswave</span>
       <select value={phase.seiswave??0} onChange={e=>update('seiswave',Number(e.target.value))}>
        <option value={0}>0 · Harmonic sine wave</option>
        <option value={1}>1 · Accelerogram record</option>
        <option value={2}>2 · Ricker pulse</option>
       </select>
      </label>
      {num('Seisamp','seisamp',phase.seisamp??1,'any','peak acc (m/s²)')}
      {num('Seisfreq','seisfreq',phase.seisfreq??2,'any','Hz')}
      {phase.seiswave===1&&num('Recdt','recdt',phase.recdt??0.02,'any','s')}
      {num('Damp','damp',phase.damp??0.05,'any','damping ratio ξ')}
      {num('Rayf1','rayf1',phase.rayf1??1,'any','f1 (Hz)')}
      {num('Rayf2','rayf2',phase.rayf2??8,'any','f2 (Hz)')}
      {check('Seisff','seisff',phase.seisff??false)}
      {check('Seiscb','seiscb',phase.seiscb??false)}
      {check('Dynnl','dynnl',phase.dynnl??false)}
      <details className="nested" open>
       <summary>Design spectrum overlay (EC8 / TBDY 2018)</summary>
       {check('Ec8on','ec8on',phase.ec8on===1||phase.ec8on===true)}
       {(phase.ec8on===1||phase.ec8on===true)&&<div className="subfield-group">
        {num('Ec8agr','ec8agr',phase.ec8agr??0.2,'any','agR (g)')}
        {num('Ec8gi','ec8gi',phase.ec8gi??1,'any','γI')}
        {num('Ec8gnd','ec8gnd',phase.ec8gnd??2,'1','0=A..4=E')}
        {num('Ec8typ','ec8typ',phase.ec8typ??0,'1','0=Type1, 1=Type2')}
       </div>}
       {num('Tbdyss','tbdyss',phase.tbdyss??1,'any','SS')}
       {num('Tbdys1','tbdys1',phase.tbdys1??0.4,'any','S1')}
       {num('Siteclass','siteclass',phase.siteclass??2,'1','0=ZA..4=ZE')}
      </details>
     </>}
    </>
   )}

   {(()=>{
    const initialOrTypeKeys=new Set([
     'name','type','duration','steps','poly','struct','load','disp','hydro',
     'design','water_override',
     ...(type===0?['mstage','tol','maxiter','resetdisp','ignoreund','resetsmall','kh','kv','flowpore']:[]),
     ...(type===1?['tol','maxiter','resetdisp']:[]),
     ...(type===2?['cstop','cminp','cdeg','cfirst','cmaxstep','tol','maxiter','flowpore']:[]),
     ...(type===3?['headramp']:[]),
     ...(type===4?['cstop','cminp','cdeg','tol','maxiter']:[]),
     ...(type===5?['seiswave','seisamp','seisfreq','recdt','damp','rayf1','rayf2','seisff','seiscb','dynnl','ec8on','ec8agr','ec8gi','ec8gnd','ec8typ','tbdyss','tbdys1','siteclass']:[]),
    ])
    const allPhaseKeys=[
     'type','design','water_override','mstage','tol','maxiter','resetdisp','ignoreund','resetsmall',
     'kh','kv','flowpore','cstop','cminp','cdeg','cfirst','cmaxstep','headramp',
     'seiswave','seisamp','seisfreq','recdt','damp','rayf1','rayf2','seisff','seiscb','dynnl',
     'ec8on','ec8agr','ec8gi','ec8gnd','ec8typ','tbdyss','tbdys1','siteclass','cloadstart'
    ]
    const unhandled=allPhaseKeys.filter(k=>!initialOrTypeKeys.has(k))
    if(!unhandled.length)return null
    return <div className="subfield-group" style={{marginTop:8}}>
     {unhandled.map(k=>{
      if(typeof phase[k]==='number'||['seisff','seiscb','dynnl','ec8on'].includes(k)){
       return num(fmt(k),k,phase[k],'any')
      }
      if(typeof phase[k]==='boolean'||['water_override','resetdisp','ignoreund','resetsmall','flowpore','headramp','cloadstart'].includes(k)){
       return check(fmt(k),k,phase[k]??false)
      }
      return num(fmt(k),k,phase[k],'any')
     })}
    </div>
   })()}
  </details>
 </div>
}


function pointInPoly(px: number, py: number, xs: number[], ys: number[]): boolean {
 let inside = false;
 const n = xs.length;
 for (let i = 0, j = n - 1; i < n; j = i++) {
  const xi = xs[i], yi = ys[i], xj = xs[j], yj = ys[j];
  const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi);
  if (intersect) inside = !inside;
 }
 return inside;
}

function pointNearSegment(p: Point, a: [number, number], b: [number, number], tol = 0.3): boolean {
 const dx = b[0] - a[0], dy = b[1] - a[1];
 const l2 = dx * dx + dy * dy;
 if (!l2) return Math.hypot(p[0] - a[0], p[1] - a[1]) < tol;
 const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
 const px = a[0] + t * dx, py = a[1] + t * dy;
 return Math.hypot(p[0] - px, p[1] - py) < tol;
}

function mergeIntervals(intervals: [number, number][], tol: number = 1e-4): [number, number][] {
 if (!intervals.length) return [];
 const sorted = intervals
  .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
  .sort((a, b) => a[0] - b[0]);
 const merged: [number, number][] = [sorted[0]];
 for (let i = 1; i < sorted.length; i++) {
  const prev = merged[merged.length - 1];
  const curr = sorted[i];
  if (curr[0] <= prev[1] + tol) {
   prev[1] = Math.max(prev[1], curr[1]);
  } else {
   merged.push(curr);
  }
 }
 return merged;
}

function drawBoundaryConditions(ctx: CanvasRenderingContext2D, bounds: Dict, tr: (x: number, y: number) => Point, project: Dict, activePolyMask?: boolean[]) {
 const polys = (project.polygons || []).filter((_: Dict, i: number) => activePolyMask ? activePolyMask[i] !== false : true);
 if (!polys.length) return;

 // Find actual domain bounds from polygons
 let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity;
 let hasPoints = false;
 for (const P of polys) {
  if (!P.x?.length || !P.y?.length) continue;
  for (let k = 0; k < P.x.length; k++) {
   const xk = Number(P.x[k]), yk = Number(P.y[k]);
   bx0 = Math.min(bx0, xk);
   bx1 = Math.max(bx1, xk);
   by0 = Math.min(by0, yk);
   hasPoints = true;
  }
 }
 if (!hasPoints) return;

 const spanX = Math.max(1.0, bx1 - bx0);
 const tol = 1e-4 * spanX;
 if (bounds.xmin != null && Math.abs(bounds.xmin - bx0) <= tol) bx0 = bounds.xmin;
 if (bounds.xmax != null && Math.abs(bounds.xmax - bx1) <= tol) bx1 = bounds.xmax;
 if (bounds.ymin != null && Math.abs(bounds.ymin - by0) <= tol) by0 = bounds.ymin;

 ctx.save();
 ctx.strokeStyle = '#475569';
 ctx.fillStyle = '#475569';
 ctx.lineWidth = 1.2;

 const bottomRaw: [number, number][] = [];
 const leftRaw: [number, number][] = [];
 const rightRaw: [number, number][] = [];
 const customEdges: { p1: Point; p2: Point; bc: number }[] = [];

 for (const P of polys) {
  const n = P.x?.length || 0;
  if (n < 3) continue;
  for (let i = 0; i < n; i++) {
   const ax = Number(P.x[i]), ay = Number(P.y[i]);
   const bx = Number(P.x[(i + 1) % n]), by = Number(P.y[(i + 1) % n]);
   const bc = Number(P.edge_bc?.[i] || 0);

   const isBottom = Math.abs(ay - by0) <= tol && Math.abs(by - by0) <= tol;
   const isLeft = Math.abs(ax - bx0) <= tol && Math.abs(bx - bx0) <= tol;
   const isRight = Math.abs(ax - bx1) <= tol && Math.abs(bx - bx1) <= tol;

   if (isBottom && (bc === 0 || bc === 4)) {
    bottomRaw.push([Math.min(ax, bx), Math.max(ax, bx)]);
   } else if (isLeft && (bc === 0 || bc === 1 || bc === 2)) {
    leftRaw.push([Math.min(ay, by), Math.max(ay, by)]);
   } else if (isRight && (bc === 0 || bc === 1 || bc === 2)) {
    rightRaw.push([Math.min(ay, by), Math.max(ay, by)]);
   } else if (bc > 0) {
    customEdges.push({ p1: tr(ax, ay), p2: tr(bx, by), bc });
   }
  }
 }

 const bottomIntervals = mergeIntervals(bottomRaw, tol);
 const leftIntervals = mergeIntervals(leftRaw, tol);
 const rightIntervals = mergeIntervals(rightRaw, tol);

 // 1. Bottom: Fully Fixed supports along actual bottom polygon edges
 for (const [xStart, xEnd] of bottomIntervals) {
  const p1 = tr(xStart, by0);
  const p2 = tr(xEnd, by0);
  const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  if (dist < 5) continue;
  const numB = Math.max(1, Math.round(dist / 28));
  for (let i = 0; i <= numB; i++) {
   const t = i / numB;
   const x = p1[0] + t * (p2[0] - p1[0]);
   const y = p1[1] + t * (p2[1] - p1[1]);
   ctx.beginPath();
   ctx.moveTo(x, y);
   ctx.lineTo(x - 5, y + 8);
   ctx.lineTo(x + 5, y + 8);
   ctx.closePath();
   ctx.stroke();
   ctx.beginPath();
   ctx.moveTo(x - 8, y + 8);
   ctx.lineTo(x + 8, y + 8);
   ctx.stroke();
   ctx.beginPath();
   ctx.moveTo(x - 6, y + 8); ctx.lineTo(x - 9, y + 13);
   ctx.moveTo(x - 1, y + 8); ctx.lineTo(x - 4, y + 13);
   ctx.moveTo(x + 4, y + 8); ctx.lineTo(x + 1, y + 13);
   ctx.stroke();
  }
 }

 // 2. Left: Normally Fixed rollers along actual left vertical polygon edges
 for (const [yStart, yEnd] of leftIntervals) {
  const pBottom = tr(bx0, yStart);
  const pTop = tr(bx0, yEnd);
  const dist = Math.hypot(pTop[0] - pBottom[0], pTop[1] - pBottom[1]);
  if (dist < 5) continue;
  const numL = Math.max(1, Math.round(dist / 32));
  for (let i = 0; i <= numL; i++) {
   const t = i / numL;
   const x = pBottom[0] + t * (pTop[0] - pBottom[0]);
   const y = pBottom[1] + t * (pTop[1] - pBottom[1]);
   ctx.beginPath();
   ctx.moveTo(x - 9, y - 7);
   ctx.lineTo(x - 9, y + 7);
   ctx.stroke();
   ctx.beginPath();
   ctx.moveTo(x - 9, y - 4); ctx.lineTo(x - 14, y - 1);
   ctx.moveTo(x - 9, y);     ctx.lineTo(x - 14, y + 3);
   ctx.moveTo(x - 9, y + 4); ctx.lineTo(x - 14, y + 7);
   ctx.stroke();
   ctx.beginPath();
   ctx.arc(x - 4.5, y - 3, 2.5, 0, Math.PI * 2);
   ctx.arc(x - 4.5, y + 3, 2.5, 0, Math.PI * 2);
   ctx.stroke();
  }
 }

 // 3. Right: Normally Fixed rollers along actual right vertical polygon edges
 for (const [yStart, yEnd] of rightIntervals) {
  const pBottom = tr(bx1, yStart);
  const pTop = tr(bx1, yEnd);
  const dist = Math.hypot(pTop[0] - pBottom[0], pTop[1] - pBottom[1]);
  if (dist < 5) continue;
  const numR = Math.max(1, Math.round(dist / 32));
  for (let i = 0; i <= numR; i++) {
   const t = i / numR;
   const x = pBottom[0] + t * (pTop[0] - pBottom[0]);
   const y = pBottom[1] + t * (pTop[1] - pBottom[1]);
   ctx.beginPath();
   ctx.moveTo(x + 9, y - 7);
   ctx.lineTo(x + 9, y + 7);
   ctx.stroke();
   ctx.beginPath();
   ctx.moveTo(x + 9, y - 4); ctx.lineTo(x + 14, y - 1);
   ctx.moveTo(x + 9, y);     ctx.lineTo(x + 14, y + 3);
   ctx.moveTo(x + 9, y + 4); ctx.lineTo(x + 14, y + 7);
   ctx.stroke();
   ctx.beginPath();
   ctx.arc(x + 4.5, y - 3, 2.5, 0, Math.PI * 2);
   ctx.arc(x + 4.5, y + 3, 2.5, 0, Math.PI * 2);
   ctx.stroke();
  }
 }

 // 4. Custom edge boundary conditions
 for (const { p1, p2, bc } of customEdges) {
  const edx = p2[0] - p1[0], edy = p2[1] - p1[1];
  const elen = Math.hypot(edx, edy);
  if (elen < 5) continue;
  const nSeg = Math.max(2, Math.floor(elen / 26));
  for (let s = 1; s < nSeg; s++) {
   const sx = p1[0] + (s / nSeg) * edx;
   const sy = p1[1] + (s / nSeg) * edy;
   ctx.beginPath();
   ctx.arc(sx, sy, 3, 0, Math.PI * 2);
   ctx.stroke();
  }
 }

 ctx.restore();
}

function drawLoads(ctx: CanvasRenderingContext2D, loads: Dict[], tr: (x: number, y: number) => Point, isPhaseActiveOrMode: ((i: number) => boolean) | string, activeOrIsOutput?: Dict | null | boolean) {
 if (!loads?.length) return;
 const isFn = typeof isPhaseActiveOrMode === 'function';
 const isOutput = typeof activeOrIsOutput === 'boolean' ? activeOrIsOutput : false;
 loads.forEach((o: Dict, i: number) => {
  if (o.x1 == null || o.y1 == null) return;
  const isPhaseActive = isFn
    ? (isPhaseActiveOrMode as (i: number) => boolean)(i)
    : (isPhaseActiveOrMode !== 'Staged Construction' || !(activeOrIsOutput as Dict | null) || (activeOrIsOutput as Dict).load?.[i] !== 0);
  if (isOutput && !isPhaseActive) return;
  const strokeColor = isPhaseActive ? '#dc2626' : '#94a3b8';
  const fillColor = isPhaseActive ? '#dc2626' : '#94a3b8';

  const p1 = tr(o.x1, o.y1);
  const p2 = tr(o.x2 ?? o.x1, o.y2 ?? o.y1);
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const length = Math.hypot(dx, dy);

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = fillColor;
  ctx.lineWidth = isPhaseActive ? 2.5 : 1.5;

  const qy = Number(o.qy1 ?? o.qy ?? -100);
  const qx = Number(o.qx1 ?? o.qx ?? 0);
  const qVal = Math.hypot(qx, qy);

  if (length < 3) {
   const arrowLen = 30;
   const ax = p1[0], ay = p1[1] - arrowLen;
   ctx.beginPath();
   ctx.moveTo(ax, ay);
   ctx.lineTo(p1[0], p1[1]);
   ctx.stroke();
   ctx.beginPath();
   ctx.moveTo(p1[0], p1[1]);
   ctx.lineTo(p1[0] - 5, p1[1] - 9);
   ctx.lineTo(p1[0] + 5, p1[1] - 9);
   ctx.closePath();
   ctx.fill();

   ctx.font = 'bold 11px sans-serif';
   const txt = `${o.name || 'Load'}: ${qVal.toFixed(1)} kN`;
   const tw = ctx.measureText(txt).width;
   ctx.fillStyle = '#ffffffea';
   ctx.beginPath();
   ctx.roundRect(ax - tw / 2 - 5, ay - 17, tw + 10, 16, 3);
   ctx.fill();
   ctx.stroke();
   ctx.fillStyle = isPhaseActive ? '#991b1b' : '#64748b';
   ctx.fillText(txt, ax - tw / 2, ay - 4);
   ctx.restore();
   return;
  }

  // Distributed Line Load
  ctx.beginPath();
  ctx.moveTo(...p1);
  ctx.lineTo(...p2);
  ctx.stroke();

  const arrowH = 26;
  const numArrows = Math.max(3, Math.min(16, Math.floor(length / 20)));
  const nx = -dy / length;
  const ny = dx / length;
  const sign = (qy <= 0) ? -1 : 1;
  const offX = nx * arrowH * sign;
  const offY = ny * arrowH * sign;

  const tails: Point[] = [];
  for (let j = 0; j <= numArrows; j++) {
   const frac = j / numArrows;
   const bx = p1[0] + frac * dx;
   const by = p1[1] + frac * dy;
   const tx = bx + offX;
   const ty = by + offY;
   tails.push([tx, ty]);

   ctx.beginPath();
   ctx.moveTo(tx, ty);
   ctx.lineTo(bx, by);
   ctx.stroke();

   const ang = Math.atan2(by - ty, bx - tx);
   ctx.beginPath();
   ctx.moveTo(bx, by);
   ctx.lineTo(bx - 6 * Math.cos(ang - 0.4), by - 6 * Math.sin(ang - 0.4));
   ctx.lineTo(bx - 6 * Math.cos(ang + 0.4), by - 6 * Math.sin(ang + 0.4));
   ctx.closePath();
   ctx.fill();
  }

  if (tails.length > 1) {
   ctx.beginPath();
   ctx.moveTo(...tails[0]);
   for (let j = 1; j < tails.length; j++) ctx.lineTo(...tails[j]);
   ctx.stroke();
  }

  const midX = (p1[0] + p2[0]) / 2 + offX * 1.35;
  const midY = (p1[1] + p2[1]) / 2 + offY * 1.35;
  ctx.font = 'bold 11px sans-serif';
  const labelText = `${o.name || 'Load'}: ${qVal.toFixed(1)} kN/m²`;
  const tw = ctx.measureText(labelText).width;
  ctx.fillStyle = '#fffffffa';
  ctx.strokeStyle = isPhaseActive ? '#dc2626bb' : '#94a3b8bb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(midX - tw / 2 - 6, midY - 14, tw + 12, 17, 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = isPhaseActive ? '#991b1b' : '#64748b';
  ctx.fillText(labelText, midX - tw / 2, midY - 1);

  ctx.restore();
 });
}

function MeshSettingsEditor({
 project,
 mesh,
 onUpdate,
 onGenerate
}:{
 project: Dict;
 mesh: Mesh | null;
 onUpdate: (nextMesh: Dict) => void;
 onGenerate: () => void;
}){
 const meshConf = project.mesh || {};
 const currentPreset = meshConf.preset || 'Medium';
 const currentOrder = Number(meshConf.order) || 6;

 const polys = project.polygons || [];
 let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
 for (const p of polys) {
  for (const x of (p.x || [])) { if (x < xmin) xmin = x; if (x > xmax) xmax = x; }
  for (const y of (p.y || [])) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
 }
 const diag = (isFinite(xmin) && isFinite(xmax) && xmax > xmin)
  ? Math.sqrt((xmax - xmin) ** 2 + (ymax - ymin) ** 2)
  : Math.sqrt((Number(project.x_max || 20) - Number(project.x_min || 0)) ** 2 + (Number(project.y_max || 10) - Number(project.y_min || 0)) ** 2);

 const presetRe: Record<string, number> = {
  'Very Coarse': 2.0,
  'Coarse': 1.4,
  'Medium': 1.0,
  'Fine': 0.7,
  'Very Fine': 0.5
 };
 const re = presetRe[currentPreset] ?? 1.0;
 const suggestedElemSize = Number((re * 0.05 * diag).toFixed(2));
 const currentElemSize = meshConf.elem_size ?? suggestedElemSize;

 return (
  <div className="mesh-settings-panel" data-testid="mesh-settings-panel">
   <div className="mesh-panel-card">
    <div className="mesh-panel-title">Edit Mesh Settings</div>
    <div className="mesh-field-row">
     <label>Generator</label>
     <select value="plaxis" disabled className="output-select" title="PLAXIS Auto-Mesher (Gmsh engine)">
      <option value="plaxis">PLAXIS Auto-Mesher</option>
     </select>
    </div>
    <div className="mesh-field-row">
     <label>Density</label>
     <select
      value={currentPreset}
      onChange={e => {
       const nextPreset = e.target.value;
       const nextRe = presetRe[nextPreset] ?? 1.0;
       const nextSize = Number((nextRe * 0.05 * diag).toFixed(2));
       onUpdate({ ...meshConf, preset: nextPreset, elem_size: nextSize });
      }}
      className="output-select"
     >
      <option value="Very Coarse">Very Coarse (2.0x)</option>
      <option value="Coarse">Coarse (1.4x)</option>
      <option value="Medium">Medium (1.0x)</option>
      <option value="Fine">Fine (0.7x)</option>
      <option value="Very Fine">Very Fine (0.5x)</option>
     </select>
    </div>
    <div className="mesh-field-row">
     <label>Element Order</label>
     <select
      value={currentOrder}
      onChange={e => onUpdate({ ...meshConf, order: Number(e.target.value) })}
      className="output-select"
     >
      <option value={15}>15-Node (Tri15 Quartic)</option>
      <option value={6}>6-Node (Tri6 Quadratic)</option>
      <option value={3}>3-Node (Tri3 Linear)</option>
     </select>
    </div>
    <div className="mesh-field-row">
     <label>Target Element Size le [m]</label>
     <input
      type="number"
      step="0.05"
      min="0.05"
      value={currentElemSize}
      onChange={e => onUpdate({ ...meshConf, elem_size: Math.max(0.01, parseFloat(e.target.value) || 1) })}
     />
    </div>
    <button type="button" className="mesh-gen-btn" onClick={onGenerate} title="Generate Mesh using PLAXIS Auto-Mesher">
     <Play size={14} fill="currentColor" /> Generate Mesh
    </button>
   </div>
   {mesh && (
    <div className="mesh-stats-card" data-testid="mesh-stats-summary">
     <div className="mesh-panel-title">Current Mesh Statistics</div>
     <div className="mesh-stats-row"><span>Total Nodes:</span><strong>{mesh.node_count.toLocaleString()}</strong></div>
     <div className="mesh-stats-row"><span>Total Elements:</span><strong>{mesh.element_count.toLocaleString()}</strong></div>
     <div className="mesh-stats-row"><span>Element Order:</span><strong>{mesh.nodes_per_element === 15 ? '15-Node Quartic (Tri15)' : mesh.nodes_per_element === 6 ? '6-Node Quadratic (Tri6)' : '3-Node Linear (Tri3)'}</strong></div>
     <div className="mesh-stats-row"><span>Engine:</span><strong>PLAXIS Style (Gmsh)</strong></div>
     <div className="mesh-stats-row"><span>Boundary Nodes:</span><strong>{(mesh.boundary_nodes||[]).length}</strong></div>
    </div>
   )}
  </div>
 );
}

function App(){
 const [token,setToken]=useState(localStorage.getItem('katai-token')||'');const [authorized,setAuthorized]=useState(false);const [project,setProject]=useState<Dict>(clone(defaults));const [projectId,setProjectId]=useState('');const [mode,setMode]=useState('Soil');const [selected,setSelected]=useState<{key:string,index:number}|null>(null);const [cursorPos,setCursorPos]=useState<Point|null>(null);const [tool,setTool]=useState('select');const [monitorPoint,setMonitorPoint]=useState<Point|null>(null);const [draft,setDraft]=useState<Point[]>([]);const [mesh,setMesh]=useState<Mesh|null>(null);const [isMeshing,setIsMeshing]=useState(false);const [results,setResults]=useState<PhaseResult[]>([]);const [phase,setPhase]=useState(0);const [structKind,setStructKind]=useState(0);const structKindRef=useRef(0);const [dropHighlight,setDropHighlight]=useState<{key:string,index:number}|null>(null);const [resultField,setResultField]=useState('Total Displacement |u| [mm]');const [job,setJob]=useState<Dict|null>(null);const [log,setLog]=useState('');const [notice,setNotice]=useState('Ready');const [validation,setValidation]=useState<Dict|null>(null);const [scale,setScale]=useState(1);const [grid,setGrid]=useState(true);const [snap,setSnap]=useState(true);const [showArrows,setShowArrows]=useState(false);const [vectorDir,setVectorDir]=useState<'total'|'x'|'y'>('total');const [showContours,setShowContours]=useState(false);const [showMeshLines,setShowMeshLines]=useState(true);const [showDeformed,setShowDeformed]=useState(true);const [deformScale,setDeformScale]=useState(1.0);const [tab,setTab]=useState<'Model'|'Output'>('Model');const [outputView,setOutputView]=useState<'mesh'|'structures'>('mesh');const [structForceType,setStructForceType]=useState<'M'|'Q'|'N'|'u'>('M');const [selectedStructIdx,setSelectedStructIdx]=useState<number>(-1);const [structDiagScale,setStructDiagScale]=useState<number>(0.02);const [treeOpen,setTreeOpen]=useState(true);const [openMenu,setOpenMenu]=useState('');const [helpOpen,setHelpOpen]=useState(false);const [presetModalOpen,setPresetModalOpen]=useState(false);const [presetCategory,setPresetCategory]=useState('All');const [presetSearch,setPresetSearch]=useState('');const canvasRef=useRef<HTMLCanvasElement>(null);const wrapRef=useRef<HTMLDivElement>(null);const view=useRef({zoom:1,panX:0,panY:0,drag:null as null|{x:number;y:number;px:number;py:number}});const history=useRef<Dict[]>([clone(defaults)]);const histIndex=useRef(0);const [resize,setResize]=useState(0)
 const request=useCallback(async(path:string,init:RequestInit={})=>{const response=await fetch(path,{...init,headers:{Authorization:`Bearer ${token}`,...(init.body?{'Content-Type':'application/json'}:{}),...init.headers}});if(response.status===401)throw Error('Access token is not accepted');if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.detail||`HTTP ${response.status}`)}return response.status===204?null:response.json()},[token])
 const setProjectSafe=(next:Dict)=>{history.current=history.current.slice(0,histIndex.current+1);history.current.push(clone(next));histIndex.current++;setProject(next);setValidation(null);setMesh(next.explicit_mesh||null);setResults([]);setPhase(0)}
 const moveHistory=(direction:number)=>{const target=Math.max(0,Math.min(history.current.length-1,histIndex.current+direction));if(target!==histIndex.current){histIndex.current=target;const snap=clone(history.current[target]);setProject(snap);setValidation(null);setMesh(snap.explicit_mesh||null);setResults([]);setPhase(0)}}
 const updateObject=(key:string,index:number,value:Dict)=>setProjectSafe(key==='project'?value:key==='initial'?{...project,initial:value}:{...project,[key]:(project[key]||[]).map((x:Dict,i:number)=>i===index?value:x)})
 const active=selected?selected.key==='project'?project:selected.key==='initial'?project.initial:(project[selected.key]||[])[selected.index]:null
 const setActive=(value:Dict)=>selected&&updateObject(selected.key,selected.index,value)
 const currentArrays=useMemo(()=>bands[mode].filter(k=>arrays.has(k)||k==='initial'||k==='Mesh settings'||k==='Groundwater'),[mode])
 async function authorize(e?:React.FormEvent){e?.preventDefault();localStorage.setItem('katai-token',token);try{await request('/api/health');setAuthorized(true);setNotice('Connected to KATAI engine')}catch(err){setNotice(String(err))}}
 async function create(data:Dict=defaults){try{const r=await request('/api/projects',{method:'POST',body:JSON.stringify({project:data})});setProjectId(r.id);setProject(clone(r.project));history.current=[clone(r.project)];histIndex.current=0;setResults([]);setMesh(r.project?.explicit_mesh||null);setSelected(null);setTab('Model');setNotice('New project created');return r.id as string}catch(e){setNotice(String(e));return ''}}
 async function ensureSaved(data:Dict=project){try{const toSave=(mesh&&!data.explicit_mesh)?{...data,explicit_mesh:mesh}:data;if(!projectId)return await create(toSave);await request(`/api/projects/${projectId}`,{method:'PUT',body:JSON.stringify({project:toSave})});setNotice('Project saved to server');return projectId}catch(e){setNotice(String(e));return ''}}
 async function save(){return ensureSaved()}
 async function reloadSaved(){if(!projectId){setNotice('This project has no saved server copy yet');return}try{const r=await request(`/api/projects/${projectId}`);setProject(clone(r.project));history.current=[clone(r.project)];histIndex.current=0;setValidation(null);setMesh(r.project?.explicit_mesh||null);setResults([]);setPhase(0);setNotice('Saved server copy reloaded')}catch(e){setNotice(String(e))}}
 async function openFile(e:ChangeEvent<HTMLInputElement>){const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());const r=await request('/api/projects/import',{method:'POST',body:JSON.stringify(data)});setProjectId(r.id);setProject(clone(r.project));history.current=[clone(r.project)];histIndex.current=0;setResults([]);setMesh(r.project?.explicit_mesh||null);setTab('Model');setNotice(`Opened ${f.name}`)}catch(err){setNotice(String(err))}e.target.value=''}
 async function loadExample(source:string|Dict){try{let data:Dict;if(typeof source==='string'){const response=await fetch(source);if(!response.ok)throw Error('Tutorial example is unavailable');data=await response.json()}else data=source;const r=await request('/api/projects/import',{method:'POST',body:JSON.stringify(data)});setProjectId(r.id);setProject(clone(r.project));history.current=[clone(r.project)];histIndex.current=0;setResults([]);setMesh(r.project?.explicit_mesh||null);setSelected(null);setTab('Model');setNotice(`Loaded ${data.name}`)}catch(e){setNotice(String(e))}}
 async function exportFile(){if(!projectId){const blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'});download(blob,'project.k2d');return}const r=await fetch(`/api/projects/${projectId}/export`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok){setNotice('Project export failed');return}download(await r.blob(),'project.k2d')}
 function download(blob:Blob,name:string){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)}
 async function validate(){const id=await ensureSaved();if(!id)return;try{const r=await request(`/api/projects/${id}/validate`,{method:'POST'});setValidation(r);setNotice(r.ok?'Model validation passed':'Model has validation issues')}catch(e){setNotice(String(e))}}
 async function generateMesh(data:Dict=project){setIsMeshing(true);try{const id=await ensureSaved(data);if(!id)return;const r=await request(`/api/projects/${id}/mesh`,{method:'POST'});if(r.mesh){setMesh(r.mesh);setProjectSafe({...data,explicit_mesh:r.mesh});const genLabel=r.generator==='plaxis'?' · PLAXIS Style':'';setNotice(`Mesh ready · ${r.mesh.node_count} nodes · ${r.mesh.element_count} elements · Tri${r.mesh.nodes_per_element}${genLabel}`)}else if(r.error){setNotice(r.error)}}catch(e){setNotice(String(e))}finally{setIsMeshing(false)}}
 async function autoMesh(presetOverride?: string | unknown){const currentPreset = typeof presetOverride === 'string' ? presetOverride : (project.mesh?.preset || 'Medium');const next={...project,mesh:{...project.mesh,auto_refine:true,generator:'plaxis',preset:currentPreset,order:project.mesh?.order||6}};setProjectSafe(next);await generateMesh(next)}
 async function calculate(){if(job&&['queued','running','cancelling'].includes(job.status)){setNotice('Calculation is already queued or running');return}const toSave=(mesh&&!project.explicit_mesh)?{...project,explicit_mesh:mesh}:project;const id=await ensureSaved(toSave);if(!id)return;try{const r=await request(`/api/projects/${id}/jobs`,{method:'POST',body:JSON.stringify(monitorPoint?{monitor:{x:monitorPoint[0],y:monitorPoint[1]}}:{})});setJob(r);setTab('Output');setPhase(0);setNotice(r.status==='running'?'Calculation is running':'Calculation queued')}catch(e){setNotice(String(e))}}
 async function cancel(){if(job)try{await request(`/api/jobs/${job.id}`,{method:'DELETE'});setNotice('Cancellation requested')}catch(e){setNotice(String(e))}}
 const loadResults=useCallback(async(forProjectId=projectId,preserveNotice=false)=>{if(!forProjectId)return;try{const r=await request(`/api/projects/${forProjectId}/results`);if(r.results?.phases?.length){setResults(r.results.phases);setPhase(Math.max(0,r.results.phases.length-1));if(r.results.phases?.[0]?.mesh){setMesh(r.results.phases[0].mesh)}if(!preserveNotice)setNotice('Results loaded from KATAI .res')}}catch(e){if(!preserveNotice)setNotice(String(e))}},[projectId,request])
 useEffect(()=>{if(!authorized||!job)return;const t=setInterval(async()=>{try{const s=await request(`/api/jobs/${job.id}`);setJob(s);setLog(s.log_text||'');if(s.status==='running'||s.status==='queued'){const lastSample=s.progress?.samples?.at(-1);if(lastSample?.phase_index!=null)setPhase(lastSample.phase_index)}if(['completed','failed','cancelled','interrupted'].includes(s.status)){clearInterval(t);if(['completed','failed'].includes(s.status)&&s.project_id===projectId)loadResults(s.project_id,s.status==='failed');setNotice(s.message)}}catch(e){setNotice(String(e))}},1000);return()=>clearInterval(t)},[authorized,job?.id,projectId,request,loadResults])
 useEffect(()=>{const ro=new ResizeObserver(()=>setResize(v=>v+1));if(wrapRef.current)ro.observe(wrapRef.current);return()=>ro.disconnect()},[])
 const activeResult=results[phase];
 const activeStrains=useMemo(()=>{
  if(!activeResult?.mesh?.node_count||!activeResult.displacement)return null;
  const disp=activeResult.displacement_total?.length?activeResult.displacement_total:activeResult.displacement;
  return computeNodalStrains(activeResult.mesh,disp);
 },[activeResult]);

 const bounds=useMemo(()=>({xmin:Number(project.x_min??0),xmax:Number(project.x_max??20),ymin:Number(project.y_min??0),ymax:Number(project.y_max??10)}),[project.x_min,project.x_max,project.y_min,project.y_max])

 const applyAutoScale=useCallback(()=>{
  if(!activeResult)return;
  const maxD=Number(activeResult.max_disp)||0;
  if(maxD<=1e-9){
   setDeformScale(1.0);
   setNotice('Scale deformasi diatur 1.0x (deformasi mendekati nol)');
   return;
  }
  const domW=bounds.xmax-bounds.xmin;
  const domH=bounds.ymax-bounds.ymin;
  const domL=Math.max(domW,domH);
  const rawScale=(0.06*domL)/maxD;
  let s=1.0;
  if(rawScale>=500)s=Math.round(rawScale/100)*100;
  else if(rawScale>=100)s=Math.round(rawScale/50)*50;
  else if(rawScale>=20)s=Math.round(rawScale/10)*10;
  else if(rawScale>=5)s=Math.round(rawScale/5)*5;
  else if(rawScale>=1)s=Math.round(rawScale);
  else s=Number(rawScale.toFixed(2));
  s=Math.max(0.1,s);
  setDeformScale(s);
  setShowDeformed(true);
  setNotice(`Scale deformasi auto-set ke ${s}x`);
 },[activeResult,bounds]);
 const canvasTransform=useCallback(()=>{const c=canvasRef.current;if(!c)return null;const dpr=window.devicePixelRatio||1;const w=c.clientWidth,h=c.clientHeight;const base=Math.min(w/Math.max(bounds.xmax-bounds.xmin,1),h/Math.max(bounds.ymax-bounds.ymin,1))*0.82*view.current.zoom;return {c,ctx:c.getContext('2d')!,w,h,dpr,base,ox:w/2-(bounds.xmin+bounds.xmax)/2*base+view.current.panX,oy:h/2+(bounds.ymin+bounds.ymax)/2*base+view.current.panY}}
 ,[bounds])
 const worldToScreen=(x:number,y:number,t:NonNullable<ReturnType<typeof canvasTransform>>):Point=>[t.ox+x*t.base,t.oy-y*t.base]

 const getScalar=(r:PhaseResult,i:number):number=>{
  const dInc=r.displacement||[];
  const dTot=(r.displacement_total&&r.displacement_total.length)?r.displacement_total:dInc;
  const s=r.stress?.[i]||[0,0,0];
  const sxx=s[0]||0,syy=s[1]||0,sxy=s[2]||0;
  const nu=0.3;
  const szz=nu*(sxx+syy);
  const sAvg=0.5*(sxx+syy);
  const radius=Math.hypot(0.5*(sxx-syy),sxy);
  const sa=sAvg+radius;
  const sb=sAvg-radius;
  const s1=Math.max(sa,szz);
  const s3=Math.min(sb,szz);
  const pPrime=-(sxx+syy+szz)/3;
  const qDev=Math.sqrt(0.5*((sxx-syy)**2+(syy-szz)**2+(szz-sxx)**2)+3*(sxy**2));

  const pActive=r.pore?.[i]||0;
  const pExcess=r.excess_pore?.[i]||0;
  const pSteady=(r.excess_pore&&r.excess_pore.length>i)?(pActive-pExcess):pActive;

  switch(resultField){
   case 'Undeformed Mesh':
    return 0;
   case 'Displacement Increments |Δu| [mm]':
    return Math.hypot(dInc[i*2]||0,dInc[i*2+1]||0)*1000;
   case 'Total Displacement |u| [mm]':
   case 'Deformed Mesh |u|':
   case 'Displacement magnitude':
    return Math.hypot(dTot[i*2]||0,dTot[i*2+1]||0)*1000;
   case 'Horizontal Displacement u_x [mm]':
   case 'Horizontal displacement':
    return (dTot[i*2]||0)*1000;
   case 'Vertical Displacement u_y [mm]':
   case 'Vertical displacement':
    return (dTot[i*2+1]||0)*1000;

   case "Cartesian Effective Stress σ'_yy [kN/m²]":
   case 'σyy':
    return syy;
   case "Horizontal Effective Stress σ'_xx [kN/m²]":
   case 'σxx':
    return sxx;
   case "Shear Stress σ_xy [kN/m²]":
   case 'τxy':
    return sxy;
   case "Out-of-plane Stress σ'_zz [kN/m²]":
    return szz;
   case "Major Principal Stress σ'_1 [kN/m²]":
    return s1;
   case "Minor Principal Stress σ'_3 [kN/m²]":
    return s3;
   case "Mean Effective Stress p' [kN/m²]":
    return pPrime;
   case "Deviatoric Stress q [kN/m²]":
    return qDev;

   case 'Vertical Strain ε_yy [%]':
    return activeStrains?.eyy[i]||0;
   case 'Horizontal Strain ε_xx [%]':
    return activeStrains?.exx[i]||0;
   case 'Shear Strain γ_xy [%]':
    return activeStrains?.gxy[i]||0;
   case 'Volumetric Strain ε_v [%]':
    return activeStrains?.ev[i]||0;
   case 'Deviatoric Strain ε_q [%]':
    return activeStrains?.eq[i]||0;

   case 'Steady State p_steady [kN/m²]':
    return pSteady;
   case 'Excess Pore Pressure p_excess [kN/m²]':
    return pExcess;
   case 'Active Pore Pressure p_active [kN/m²]':
   case 'Pore pressure':
    return pActive;

   case 'Plastic Points (MC / Hardening / Tension Cut-off)': {
    const phi=30*Math.PI/180,c=5,sinPhi=Math.sin(phi),cosPhi=Math.cos(phi);
    const qMax=Math.max(0.1,(6*sinPhi*Math.max(0,pPrime)+6*c*cosPhi)/(3-sinPhi));
    return Math.min(100,Math.max(0,(qDev/qMax)*100));
   }

   default:
    return Math.hypot(dTot[i*2]||0,dTot[i*2+1]||0)*1000;
  }
 };

 const resultUnit=useMemo(()=>{
  if(resultField==='Undeformed Mesh')return '';
  if(resultField.includes('[mm]')||resultField.includes('Displacement')||resultField.includes('Deformed Mesh'))return 'mm';
  if(resultField.includes('[%]')||resultField.includes('Strain'))return '%';
  if(resultField.includes('[kN/m²]')||resultField.includes('Stress')||resultField.includes('p_')||resultField.includes('σ')||resultField.includes('τ')||resultField.includes('pressure'))return 'kN/m²';
  return '';
 },[resultField]);

 const resultRange=useMemo(()=>{
  if(!activeResult||resultField==='Undeformed Mesh')return null;
  const m=activeResult.mesh;
  if(!m)return null;
  const currentPhaseObj = phase === 0 ? project.initial : project.phases?.[phase - 1];
  const phasePoly = currentPhaseObj?.poly;
  const hasActArray = Boolean(activeResult.active && activeResult.active.length >= m.element_count);
  const activeNodeSet = new Set<number>();
  const npe = m.nodes_per_element || 3;
  for(let e=0; e<m.element_count; e++){
   let isActive = true;
   if(hasActArray){
    isActive = Boolean(activeResult.active?.[e]);
   }else if(phasePoly?.length && !phasePoly.every((v:number)=>v!==0)){
    const n0=m.connectivity[e*npe], n1=m.connectivity[e*npe+1], n2=m.connectivity[e*npe+2];
    if(n0!=null&&n1!=null&&n2!=null){
     const cx=(m.x[n0]+m.x[n1]+m.x[n2])/3;
     const cy=(m.y[n0]+m.y[n1]+m.y[n2])/3;
     const polys=project.polygons||[];
     let owner=-1;
     for(let pIdx=0;pIdx<polys.length;pIdx++){
      const p=polys[pIdx];
      if(p.x&&p.y&&pointInPoly(cx,cy,p.x,p.y))owner=pIdx;
     }
     if(owner>=0&&phasePoly[owner]===0)isActive=false;
    }
   }
   if(isActive){
    for(let k=0;k<npe;k++){
     const nid=m.connectivity[e*npe+k];
     if(nid!=null)activeNodeSet.add(nid);
    }
   }
  }
  const nodesToUse = activeNodeSet.size>0 ? Array.from(activeNodeSet) : m.x.map((_,i)=>i);
  const values=nodesToUse.map(i=>getScalar(activeResult,i)).filter(v=>v!==undefined&&!isNaN(v));
  if(!values.length)return {min:0,max:0};
  return {min:Math.min(...values),max:Math.max(...values)}
 },[activeResult,resultField,activeStrains,phase,project])
 const applyStructAutoScale = useCallback((forceType = structForceType) => {
  if (!activeResult?.struct_forces?.length) return;
  let maxVal = 0;
  for (const sf of activeResult.struct_forces) {
   if (!sf.stations) continue;
   for (const st of sf.stations) {
    let val = 0;
    if (forceType === 'M') val = Math.abs(st[5] || 0);
    else if (forceType === 'Q') val = Math.abs(st[4] || 0);
    else if (forceType === 'N') val = Math.abs(st[3] || 0);
    else if (forceType === 'u') val = Math.hypot(st[6] || 0, st[7] || 0) * 1000;
    if (val > maxVal) maxVal = val;
   }
  }
  if (maxVal > 1e-6) {
   const targetSpan = Math.max(2, (bounds.xmax - bounds.xmin) * 0.15);
   const rawScale = targetSpan / maxVal;
   const exp = Math.floor(Math.log10(rawScale));
   const frac = rawScale / Math.pow(10, exp);
   let niceFrac = 1;
   if (frac >= 3.5) niceFrac = 5;
   else if (frac >= 1.5) niceFrac = 2;
   const niceScale = Number((niceFrac * Math.pow(10, exp)).toPrecision(3));
   setStructDiagScale(niceScale);
  }
 }, [activeResult, bounds, structForceType]);

 const structSummary = useMemo(() => {
  if (tab !== 'Output' || outputView !== 'structures' || !activeResult) return null;
  const sfs = activeResult.struct_forces || [];
  if (!sfs.length) return null;
  const sf = (selectedStructIdx >= 0 && selectedStructIdx < sfs.length) ? sfs[selectedStructIdx] : sfs[0];
  if (!sf || !sf.stations || !sf.stations.length) return null;

  let maxVal = -Infinity, minVal = Infinity;
  let maxSt = sf.stations[0], minSt = sf.stations[0];
  for (const st of sf.stations) {
   let val = 0;
   if (structForceType === 'M') val = st[5] || 0;
   else if (structForceType === 'Q') val = st[4] || 0;
   else if (structForceType === 'N') val = st[3] || 0;
   else if (structForceType === 'u') val = Math.hypot(st[6] || 0, st[7] || 0) * 1000;

   if (val > maxVal) { maxVal = val; maxSt = st; }
   if (val < minVal) { minVal = val; minSt = st; }
  }

  const titleMap: Record<string, string> = {
   M: 'Bending moments M',
   Q: 'Shear forces Q',
   N: 'Axial forces N',
   u: 'Total displacement |u|'
  };
  const unitMap: Record<string, string> = {
   M: 'kN m/m',
   Q: 'kN/m',
   N: 'kN/m',
   u: 'mm'
  };

  return {
   title: titleMap[structForceType] || 'Force diagram',
   unit: unitMap[structForceType] || '',
   maxVal,
   minVal,
   maxLoc: `at (x=${maxSt[1].toFixed(2)}, y=${maxSt[2].toFixed(2)} m)`,
   minLoc: `at (x=${minSt[1].toFixed(2)}, y=${minSt[2].toFixed(2)} m)`
  };
 }, [tab, outputView, activeResult, selectedStructIdx, structForceType]);

 const footingReaction=useMemo(()=>{if(!activeResult||!project.axisymmetric)return null;const current=activeResult.reaction as number[]|undefined;if(!current?.length)return null;const phaseFlags=project.phases?.[Math.max(0,phase-1)]?.disp||[],activeDisps=(project.disps||[]).filter((_:Dict,i:number)=>Number(phaseFlags[i]||0)>0);let perRadian=0;if(activeDisps.length){for(const d of activeDisps){const dx=d.x2-d.x1,dy=d.y2-d.y1,length=Math.hypot(dx,dy)||1;for(let i=0;i<activeResult.mesh.node_count;i++){const x=activeResult.mesh.x[i],y=activeResult.mesh.y[i],projection=((x-d.x1)*dx+(y-d.y1)*dy)/(length*length),distance=Math.abs(dx*(d.y1-y)-dy*(d.x1-x))/length;if(projection>=-1e-8&&projection<=1+1e-8&&distance<1e-7)perRadian+=Number(current[i*2+1]||0)}}}else if(phase>0&&results[phase-1]?.reaction){const previous=results[phase-1].reaction as number[];for(let i=1;i<current.length;i+=2)perRadian+=Number(current[i]||0)-Number(previous[i]||0)}else return null;return Math.abs(perRadian*2*Math.PI)},[activeResult,phase,project.axisymmetric,project.disps,project.phases,results])
 useEffect(()=>{const t=canvasTransform();if(!t)return;const {ctx,c,w,h,dpr,base,ox,oy}=t;c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle='#f8fafc';ctx.fillRect(0,0,w,h)
  const tr=(x:number,y:number):Point=>[ox+x*base,oy-y*base];if(grid){ctx.strokeStyle='#e8edf2';ctx.lineWidth=1;const step=Number(project.mesh?.elem_size)||1;for(let x=Math.ceil(bounds.xmin/step)*step;x<=bounds.xmax;x+=step){const [sx]=tr(x,0);ctx.beginPath();ctx.moveTo(sx,0);ctx.lineTo(sx,h);ctx.stroke()}for(let y=Math.ceil(bounds.ymin/step)*step;y<=bounds.ymax;y+=step){const [,sy]=tr(0,y);ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(w,sy);ctx.stroke()}}
  const isUndeformed = tab === 'Output' && (resultField === 'Undeformed Mesh' || !showDeformed);
  const effScale = (tab === 'Output' && !isUndeformed) ? (Number(deformScale) || 0) : (tab === 'Output' ? 0 : 1.0);
  const drawMesh=(m:Mesh,r?:PhaseResult)=>{
   const currentPhaseObj = tab === 'Output'
    ? (phase === 0 ? project.initial : project.phases?.[phase - 1])
    : (mode === 'Staged Construction' && active ? active : null);
   const phasePoly = currentPhaseObj?.poly;

   const isElemActive = (e: number): boolean => {
    if (r?.active && r.active.length > e) {
     return r.active[e] !== 0;
    }
    if (phasePoly?.length && !phasePoly.every((v: number) => v !== 0)) {
     const npe = m.nodes_per_element || 3;
     const n0 = m.connectivity[e * npe];
     const n1 = m.connectivity[e * npe + 1];
     const n2 = m.connectivity[e * npe + 2];
     if (n0 != null && n1 != null && n2 != null) {
      const cx = (m.x[n0] + m.x[n1] + m.x[n2]) / 3;
      const cy = (m.y[n0] + m.y[n1] + m.y[n2]) / 3;
      const polys = project.polygons || [];
      let owner = -1;
      for (let pIdx = 0; pIdx < polys.length; pIdx++) {
       const p = polys[pIdx];
       if (p.x && p.y && pointInPoly(cx, cy, p.x, p.y)) owner = pIdx;
      }
      if (owner >= 0 && phasePoly[owner] === 0) return false;
     }
    }
    return true;
   };

   const activeElemMask = new Uint8Array(m.element_count);
   const activeNodeSet = new Set<number>();
   const npe = m.nodes_per_element || 3;
   for (let e = 0; e < m.element_count; e++) {
    if (isElemActive(e)) {
     activeElemMask[e] = 1;
     for (let k = 0; k < npe; k++) {
      const nid = m.connectivity[e * npe + k];
      if (nid != null) activeNodeSet.add(nid);
     }
    }
   }

   const vals=r?m.x.map((_,i)=>getScalar(r,i)):[];
   let min=Infinity,max=-Infinity;
   if(r){
    if(activeNodeSet.size>0){
     activeNodeSet.forEach(i=>{
      const v=vals[i];
      if(v!==undefined&&!isNaN(v)){
       min=Math.min(min,v);
       max=Math.max(max,v);
      }
     });
    }else{
     vals.forEach(v=>{min=Math.min(min,v);max=Math.max(max,v)});
    }
    if(min===Infinity||isNaN(min)){min=0;max=1;}
    if(min===max){min-=0.5;max+=0.5;}
   }
   const rgb=(u:number)=>{
    u=max===min?.5:Math.max(0,Math.min(1,(u-min)/(max-min)));
    const stops=[
     [30,58,138],
     [37,99,235],
     [6,182,212],
     [16,185,129],
     [132,204,22],
     [234,179,8],
     [249,115,22],
     [220,38,38],
     [153,27,27]
    ];
    const k=u*(stops.length-1),a=Math.floor(k),f=k-a,p=stops[a],q=stops[Math.min(a+1,stops.length-1)];
    return `rgb(${Math.round(p[0]+(q[0]-p[0])*f)},${Math.round(p[1]+(q[1]-p[1])*f)},${Math.round(p[2]+(q[2]-p[2])*f)})`
   };

   if(!r || resultField === 'Undeformed Mesh'){
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 0.75;
    for(let e=0;e<m.element_count;e++){
     if(r && !activeElemMask[e]) continue;
     const ids=m.connectivity.slice(e*m.nodes_per_element,e*m.nodes_per_element+3);
     if(ids.length<3)continue;
     const xy=ids.map(i=>tr(m.x[i],m.y[i]));
     ctx.beginPath();
     ctx.moveTo(...xy[0]);
     xy.slice(1).forEach(p=>ctx.lineTo(...p));
     ctx.closePath();
     if(r) ctx.fill();
     ctx.stroke();
    }
    if(r){
     ctx.fillStyle='#17212b';
     ctx.font='12px sans-serif';
     ctx.fillText(`Undeformed Mesh · Elements: ${m.element_count} · Active: ${activeElemMask.filter(Boolean).length}`,18,h-34);
    }
    return;
   }

   const N=6;
   const microTris:{pts:[Point,Point,Point],val:number,vA:number,vB:number,vC:number}[]=[];

   for(let e=0;e<m.element_count;e++){
    if(!activeElemMask[e]) continue;
    const elemNodes=m.connectivity.slice(e*m.nodes_per_element,(e+1)*m.nodes_per_element);
    if(elemNodes.length<3)continue;

    let V:number[];
    if(m.nodes_per_element===15&&elemNodes.length>=15){
     V=[vals[elemNodes[0]],vals[elemNodes[1]],vals[elemNodes[2]],vals[elemNodes[4]],vals[elemNodes[7]],vals[elemNodes[10]]];
    }else if(elemNodes.length>=6){
     V=[vals[elemNodes[0]],vals[elemNodes[1]],vals[elemNodes[2]],vals[elemNodes[3]],vals[elemNodes[4]],vals[elemNodes[5]]];
    }else{
     V=[vals[elemNodes[0]],vals[elemNodes[1]],vals[elemNodes[2]]];
    }

    const p0=tr(m.x[elemNodes[0]]+(r.displacement?.[elemNodes[0]*2]||0)*effScale,m.y[elemNodes[0]]+(r.displacement?.[elemNodes[0]*2+1]||0)*effScale);
    const p1=tr(m.x[elemNodes[1]]+(r.displacement?.[elemNodes[1]*2]||0)*effScale,m.y[elemNodes[1]]+(r.displacement?.[elemNodes[1]*2+1]||0)*effScale);
    const p2=tr(m.x[elemNodes[2]]+(r.displacement?.[elemNodes[2]*2]||0)*effScale,m.y[elemNodes[2]]+(r.displacement?.[elemNodes[2]*2+1]||0)*effScale);

    const hasQuad=V.length===6&&V.every(x=>x!==undefined&&!isNaN(x));

    const grid:{pt:Point,val:number}[][]=Array.from({length:N+1},()=>[]);
    for(let i=0;i<=N;i++){
     const u=i/N;
     for(let j=0;j<=N-i;j++){
      const v=j/N;
      const w=1-u-v;
      const px=w*p0[0]+u*p1[0]+v*p2[0];
      const py=w*p0[1]+u*p1[1]+v*p2[1];
      let pval:number;
      if(hasQuad){
       const n0=w*(2*w-1),n1=u*(2*u-1),n2=v*(2*v-1);
       const n3=4*w*u,n4=4*u*v,n5=4*v*w;
       pval=n0*V[0]+n1*V[1]+n2*V[2]+n3*V[3]+n4*V[4]+n5*V[5];
      }else{
       pval=w*V[0]+u*V[1]+v*V[2];
      }
      grid[i][j]={pt:[px,py],val:pval};
     }
    }

    for(let i=0;i<N;i++){
     for(let j=0;j<N-i;j++){
      const pA=grid[i][j],pB=grid[i+1][j],pC=grid[i][j+1];
      const mean1=(pA.val+pB.val+pC.val)/3;
      const col1=rgb(mean1);
      ctx.fillStyle=col1;
      ctx.strokeStyle=col1;
      ctx.lineWidth=.5;
      ctx.beginPath();
      ctx.moveTo(...pA.pt);
      ctx.lineTo(...pB.pt);
      ctx.lineTo(...pC.pt);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if(showContours){
       microTris.push({pts:[pA.pt,pB.pt,pC.pt],val:mean1,vA:pA.val,vB:pB.val,vC:pC.val});
      }

      if(i+j<N-1){
       const pD=grid[i+1][j+1];
       const mean2=(pB.val+pD.val+pC.val)/3;
       const col2=rgb(mean2);
       ctx.fillStyle=col2;
       ctx.strokeStyle=col2;
       ctx.lineWidth=.5;
       ctx.beginPath();
       ctx.moveTo(...pB.pt);
       ctx.lineTo(...pD.pt);
       ctx.lineTo(...pC.pt);
       ctx.closePath();
       ctx.fill();
       ctx.stroke();

       if(showContours){
        microTris.push({pts:[pB.pt,pD.pt,pC.pt],val:mean2,vA:pB.val,vB:pD.val,vC:pC.val});
       }
      }
     }
    }
   }

   if(showMeshLines){
    ctx.strokeStyle='rgba(25,40,55,.42)';
    ctx.lineWidth=.65;
    for(let e=0;e<m.element_count;e++){
     if(!activeElemMask[e]) continue;
     const ids=m.connectivity.slice(e*m.nodes_per_element,e*m.nodes_per_element+3);
     if(ids.length<3)continue;
     const xy=ids.map(i=>{
      const x=m.x[i]+(r.displacement?.[i*2]||0)*effScale;
      const y=m.y[i]+(r.displacement?.[i*2+1]||0)*effScale;
      return tr(x,y);
     });
     ctx.beginPath();
     ctx.moveTo(...xy[0]);
     xy.slice(1).forEach(p=>ctx.lineTo(...p));
     ctx.closePath();
     ctx.stroke();
    }
   }

   if(showContours&&max>min){
    ctx.strokeStyle='rgba(15,23,42,.68)';
    ctx.lineWidth=.75;
    const numLevels=15;
    for(let level=1;level<numLevels;level++){
     const target=min+(max-min)*level/numLevels;
     for(const tri of microTris){
      const pts=tri.pts;
      const v=[tri.vA,tri.vB,tri.vC];
      const hits:Point[]=[];
      for(let j=0;j<3;j++){
       const va=v[j],vb=v[(j+1)%3];
       if((va<target&&vb>=target)||(vb<target&&va>=target)){
        const f=(target-va)/(vb-va);
        const pa=pts[j],pb=pts[(j+1)%3];
        hits.push([pa[0]+f*(pb[0]-pa[0]),pa[1]+f*(pb[1]-pa[1])]);
       }
      }
      if(hits.length===2){
       ctx.beginPath();
       ctx.moveTo(...hits[0]);
       ctx.lineTo(...hits[1]);
       ctx.stroke();
      }
     }
    }
   }

   if(showArrows){
    const dTot=(r.displacement_total&&r.displacement_total.length)?r.displacement_total:(r.displacement||[]);
    let maxD=1e-12;
    for(let i=0;i<m.node_count;i++){
     if(!activeNodeSet.has(i)) continue;
     const ux=dTot[i*2]||0, uy=dTot[i*2+1]||0;
     let mag=0;
     if(vectorDir==='total') mag=Math.hypot(ux,uy);
     else if(vectorDir==='x') mag=Math.abs(ux);
     else if(vectorDir==='y') mag=Math.abs(uy);
     if(mag>maxD) maxD=mag;
    }
    const stride=Math.max(1,Math.ceil(m.node_count/220)),arrowLength=Math.min(26,Math.max(9,base*.22));
    ctx.strokeStyle='#1c3446';
    ctx.fillStyle='#1c3446';
    ctx.lineWidth=1;
    for(let i=0;i<m.node_count;i+=stride){
     if(!activeNodeSet.has(i)) continue;
     const ux=dTot[i*2]||0,uy=dTot[i*2+1]||0;
     let vx=0,vy=0,d=0;
     if(vectorDir==='total'){
      vx=ux; vy=uy; d=Math.hypot(ux,uy);
     } else if(vectorDir==='x'){
      vx=ux; vy=0; d=Math.abs(ux);
     } else if(vectorDir==='y'){
      vx=0; vy=uy; d=Math.abs(uy);
     }
     if(!d || d<1e-12) continue;
     const originX = isUndeformed ? m.x[i] : (m.x[i] + ux * effScale);
     const originY = isUndeformed ? m.y[i] : (m.y[i] + uy * effScale);
     const [sx,sy]=tr(originX,originY),ex=sx+(vx/d)*arrowLength*(d/maxD),ey=sy-(vy/d)*arrowLength*(d/maxD);
     ctx.beginPath();
     ctx.moveTo(sx,sy);
     ctx.lineTo(ex,ey);
     ctx.stroke();
     const a=Math.atan2(ey-sy,ex-sx);
     ctx.beginPath();
     ctx.moveTo(ex,ey);
     ctx.lineTo(ex-4*Math.cos(a-.5),ey-4*Math.sin(a-.5));
     ctx.lineTo(ex-4*Math.cos(a+.5),ey-4*Math.sin(a+.5));
     ctx.closePath();
     ctx.fill();
    }
   }

   if(resultField.startsWith('Plastic Points')){
    for(let i=0;i<m.node_count;i++){
     if(!activeNodeSet.has(i)) continue;
     const val=getScalar(r,i);
     if(val>=85){
      const [sx,sy]=tr(m.x[i]+(r.displacement?.[i*2]||0),m.y[i]+(r.displacement?.[i*2+1]||0));
      ctx.fillStyle='#dc2626';ctx.strokeStyle='#7f1d1d';ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(sx,sy,3.5,0,Math.PI*2);ctx.fill();ctx.stroke();
     }
    }
   }

   if(r){ctx.fillStyle='#17212b';ctx.font='12px sans-serif';ctx.fillText(`${resultField} · min ${min.toPrecision(3)} · max ${max.toPrecision(3)} ${resultUnit}`,18,h-34)} }
  const currentPhaseObj = tab === 'Output'
   ? (phase === 0 ? project.initial : project.phases?.[phase - 1])
   : (mode === 'Staged Construction' && active ? active : null);

  const activePolyMask = project.polygons?.map((_: any, i: number) => {
   if (!currentPhaseObj) return true;
   return currentPhaseObj.poly?.[i] !== 0;
  });

  if (tab === 'Output' && outputView === 'structures') {
   // Dedicated CAD view of structures and force diagrams
   const polys = project.polygons || [];
   polys.forEach((p: Dict, i: number) => {
    if (!p.x?.length) return;
    const isPhaseActive = currentPhaseObj ? currentPhaseObj.poly?.[i] !== 0 : true;
    if (!isPhaseActive) return;
    ctx.beginPath();
    ctx.moveTo(...tr(p.x[0], p.y[0]));
    for (let j = 1; j < p.x.length; j++) ctx.lineTo(...tr(p.x[j], p.y[j]));
    ctx.closePath();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5;
    ctx.stroke();
   });

   const structs = project.structs || [];
   structs.forEach((o: Dict, i: number) => {
    if (o.x1 == null || o.y1 == null) return;
    const isPhaseActive = currentPhaseObj ? currentPhaseObj.struct?.[i] !== 0 : true;
    if (!isPhaseActive) return;
    if (selectedStructIdx >= 0 && selectedStructIdx !== i) return;

    const sf = (activeResult?.struct_forces || []).find((s: Dict) => s.name === o.name)
      || (activeResult?.struct_forces || [])[i];

    const x1 = o.x1, y1 = o.y1, x2 = o.x2 ?? o.x1, y2 = o.y2 ?? o.y1;
    const segDx = x2 - x1, segDy = y2 - y1, segLen = Math.hypot(segDx, segDy);
    if (segLen < 1e-6) return;

    const nx = -segDy / segLen;
    const ny = segDx / segLen;

    if (sf && Array.isArray(sf.stations) && sf.stations.length >= 2) {
     const stations: number[][] = sf.stations;
     const basePts: Point[] = [];
     const diagPts: Point[] = [];
     let maxVal = -Infinity, minVal = Infinity;
     let maxDiagPt: Point = [0, 0], minDiagPt: Point = [0, 0];
     let maxValRaw = 0, minValRaw = 0;

     stations.forEach((st: number[]) => {
      const bx = st[1], by = st[2];
      let val = 0;
      if (structForceType === 'M') val = st[5] || 0;
      else if (structForceType === 'Q') val = st[4] || 0;
      else if (structForceType === 'N') val = st[3] || 0;
      else if (structForceType === 'u') val = Math.hypot(st[6] || 0, st[7] || 0) * 1000;

      const offset = val * structDiagScale;
      const dx = bx + nx * offset;
      const dy = by + ny * offset;

      const pScr = tr(bx, by);
      const qScr = tr(dx, dy);
      basePts.push(pScr);
      diagPts.push(qScr);

      if (val > maxVal) {
       maxVal = val;
       maxValRaw = val;
       maxDiagPt = qScr;
      }
      if (val < minVal) {
       minVal = val;
       minValRaw = val;
       minDiagPt = qScr;
      }
     });

     // Filled red lobe
     ctx.beginPath();
     ctx.moveTo(...basePts[0]);
     for (let k = 0; k < diagPts.length; k++) ctx.lineTo(...diagPts[k]);
     ctx.lineTo(...basePts[basePts.length - 1]);
     ctx.closePath();
     ctx.fillStyle = 'rgba(220, 38, 38, 0.85)';
     ctx.fill();

     // Transverse hatch lines
     const hatchStep = Math.max(1, Math.floor(stations.length / 35));
     ctx.beginPath();
     for (let k = 0; k < stations.length; k += hatchStep) {
      ctx.moveTo(...basePts[k]);
      ctx.lineTo(...diagPts[k]);
     }
     ctx.moveTo(...basePts[basePts.length - 1]);
     ctx.lineTo(...diagPts[diagPts.length - 1]);
     ctx.strokeStyle = 'rgba(30, 58, 138, 0.7)';
     ctx.lineWidth = 1;
     ctx.stroke();

     // Diagram border
     ctx.beginPath();
     ctx.moveTo(...diagPts[0]);
     for (let k = 1; k < diagPts.length; k++) ctx.lineTo(...diagPts[k]);
     ctx.strokeStyle = '#991b1b';
     ctx.lineWidth = 2;
     ctx.stroke();

     // Baseline
     ctx.beginPath();
     ctx.moveTo(...basePts[0]);
     for (let k = 1; k < basePts.length; k++) ctx.lineTo(...basePts[k]);
     ctx.strokeStyle = '#1d4ed8';
     ctx.lineWidth = 4;
     ctx.stroke();

     // Peak extremum labels (+ and -)
     ctx.font = 'bold 14px sans-serif';
     ctx.textAlign = 'center';
     ctx.textBaseline = 'middle';
     if (maxValRaw > 1e-4) {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(maxDiagPt[0], maxDiagPt[1], 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.fillStyle = '#dc2626';
      ctx.fillText('+', maxDiagPt[0] + 12, maxDiagPt[1]);
     }
     if (minValRaw < -1e-4) {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(minDiagPt[0], minDiagPt[1], 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.fillStyle = '#dc2626';
      ctx.fillText('–', minDiagPt[0] - 12, minDiagPt[1]);
     }
     ctx.textAlign = 'start';
     ctx.textBaseline = 'alphabetic';
    } else {
     const p1 = tr(x1, y1), p2 = tr(x2, y2);
     ctx.beginPath();
     ctx.moveTo(...p1);
     ctx.lineTo(...p2);
     ctx.strokeStyle = '#1d4ed8';
     ctx.lineWidth = 4;
     ctx.stroke();
    }
   });
  } else if (tab === 'Output') {
   // OUTPUT SOIL & RESULT MESH VIEW
   if (activeResult) {
    drawMesh(activeResult.mesh, activeResult);

    // Draw structures on deformed mesh or station coords
    const structs = project.structs || [];
    structs.forEach((o: Dict, i: number) => {
     if (o.x1 == null || o.y1 == null) return;
     const isPhaseActive = currentPhaseObj ? currentPhaseObj.struct?.[i] !== 0 : true;
     if (!isPhaseActive) return;

     const kind = Number(o.kind ?? 0);
     const kindColors: Record<number, string> = { 0: '#1d4ed8', 1: '#7c3aed', 2: '#059669', 3: '#9333ea', 4: '#ea580c' };
     const drawColor = kindColors[kind] || '#244869';

     let pts: Point[] = [];
     const x1 = o.x1, y1 = o.y1, x2 = o.x2 ?? o.x1, y2 = o.y2 ?? o.y1;
     const sf = (activeResult?.struct_forces || []).find((s: Dict) => s.name === o.name)
       || (activeResult?.struct_forces || [])[i];

     if (sf && Array.isArray(sf.stations) && sf.stations.length >= 2) {
      pts = sf.stations.map((st: number[]) => {
       const sx = st[1] + (effScale > 0 ? (st[6] || 0) * effScale : 0);
       const sy = st[2] + (effScale > 0 ? (st[7] || 0) * effScale : 0);
       return tr(sx, sy);
      });
     } else if (activeResult.mesh && effScale > 0) {
      const m = activeResult.mesh;
      const d = activeResult.displacement || [];
      const getNearestDisp = (px: number, py: number) => {
       let bestDist = Infinity, ux = 0, uy = 0;
       for (let n = 0; n < m.node_count; n++) {
        const dist = Math.hypot(m.x[n] - px, m.y[n] - py);
        if (dist < bestDist) {
         bestDist = dist;
         ux = (d[n * 2] || 0) * effScale;
         uy = (d[n * 2 + 1] || 0) * effScale;
         if (dist < 1e-4) break;
        }
       }
       return [ux, uy];
      };
      const [u1x, u1y] = getNearestDisp(x1, y1);
      const [u2x, u2y] = getNearestDisp(x2, y2);
      pts = [tr(x1 + u1x, y1 + u1y), tr(x2 + u2x, y2 + u2y)];
     } else {
      pts = [tr(x1, y1), tr(x2, y2)];
     }

     if (pts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(...pts[0]);
      for (let pIdx = 1; pIdx < pts.length; pIdx++) ctx.lineTo(...pts[pIdx]);
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = kind === 0 ? 3.5 : 2.5;
      if (kind === 2 || kind === 4) ctx.setLineDash([6, 3]); else ctx.setLineDash([]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = drawColor;
      ctx.beginPath();
      ctx.arc(...pts[0], 3.5, 0, Math.PI * 2);
      ctx.arc(...pts[pts.length - 1], 3.5, 0, Math.PI * 2);
      ctx.fill();
     }
    });
   } else {
    // No results yet for this phase
    ctx.strokeStyle = '#94a3b866';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const pMin = tr(bounds.xmin, bounds.ymin);
    const pMax = tr(bounds.xmax, bounds.ymax);
    ctx.strokeRect(Math.min(pMin[0], pMax[0]), Math.min(pMin[1], pMax[1]), Math.abs(pMax[0] - pMin[0]), Math.abs(pMax[1] - pMin[1]));
    ctx.setLineDash([]);
   }
  } else {
   // ==========================================
   // INPUT SHELL CANVAS (tab === 'Model')
   // ==========================================
   // 1. Mesh lines (when mode === 'Mesh' and mesh exists)
   if (mode === 'Mesh' && mesh) {
    drawMesh(mesh);
   }

   // 2. Boundary conditions
   drawBoundaryConditions(ctx, bounds, tr, project, activePolyMask);

   // 3. Soil polygons (Material fill + stroke + names)
   const polys = project.polygons || [];
   polys.forEach((p: Dict, i: number) => {
    if (!p.x?.length) return;
    const isPhaseActive = mode !== 'Staged Construction' || !active || active.poly?.[i] !== 0;
    const isDrop = dropHighlight?.key === 'polygons' && dropHighlight.index === i;
    ctx.beginPath();
    const pos = tr(p.x[0], p.y[0]);
    ctx.moveTo(...pos);
    for (let j = 1; j < p.x.length; j++) ctx.lineTo(...tr(p.x[j], p.y[j]));
    ctx.closePath();
    if (isPhaseActive) {
     ctx.fillStyle = `${colors[i % colors.length]}55`;
     ctx.strokeStyle = isDrop ? '#0284c7' : colors[i % colors.length];
     ctx.lineWidth = isDrop ? 3.5 : 2;
    } else {
     ctx.fillStyle = '#94a3b822';
     ctx.strokeStyle = isDrop ? '#0284c7' : '#94a3b855';
     ctx.lineWidth = isDrop ? 3.5 : 1;
    }
    if (isDrop) { ctx.save(); ctx.shadowColor = '#0284c7'; ctx.shadowBlur = 8; }
    ctx.fill();
    ctx.stroke();
    if (isDrop) ctx.restore();

    if (mode !== 'Mesh') {
     ctx.fillStyle = isPhaseActive ? '#334155' : '#94a3b8';
     ctx.font = 'bold 13px sans-serif';
     const cx = p.x.reduce((a: number, b: number) => a + b, 0) / p.x.length;
     const cy = p.y.reduce((a: number, b: number) => a + b, 0) / p.y.length;
     ctx.fillText(p.name || `Soil ${i + 1}`, ...tr(cx, cy));
    }
   });

   // 4. Boreholes
   (project.boreholes || []).forEach((b: Dict, i: number) => {
    const x = Number(b.x) || 0, top = tr(x, Number(b.level ?? bounds.ymax)), bottom = tr(x, bounds.ymin);
    ctx.beginPath(); ctx.moveTo(...top); ctx.lineTo(...bottom);
    ctx.strokeStyle = colors[i % colors.length]; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = colors[i % colors.length]; ctx.beginPath(); ctx.arc(...top, 4, 0, Math.PI * 2); ctx.fill();
   });

   // 5. Undeformed Structures + Interfaces
   (project.structs || []).forEach((o: Dict, i: number) => {
    if (o.x1 == null || o.y1 == null) return;
    const isPhaseActive = mode !== 'Staged Construction' || !active || active.struct?.[i] !== 0;
    const isDrop = dropHighlight?.key === 'structs' && dropHighlight.index === i;
    const kind = Number(o.kind ?? 0);
    const kindColors: Record<number, string> = { 0: '#1d4ed8', 1: '#7c3aed', 2: '#059669', 3: '#9333ea', 4: '#ea580c' };
    const drawColor = isPhaseActive ? (isDrop ? '#0284c7' : kindColors[kind] || '#244869') : '#94a3b855';

    const x1 = o.x1, y1 = o.y1, x2 = o.x2 ?? o.x1, y2 = o.y2 ?? o.y1;
    const pts = [tr(x1, y1), tr(x2, y2)];

    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    ctx.lineTo(...pts[1]);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = isDrop ? 4 : (kind === 0 ? 3.5 : 2.5);
    if (kind === 2 || kind === 4) ctx.setLineDash([6, 3]); else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = drawColor;
    ctx.beginPath();
    ctx.arc(...pts[0], 3.5, 0, Math.PI * 2);
    ctx.arc(...pts[1], 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Soil-Structure Interaction (Interface) Drawing
    const hasIfacePos = Boolean(o.iface_pos);
    const hasIfaceNeg = Boolean(o.iface_neg);
    const isInterfaceKind = (kind === 4);

    if (hasIfacePos || hasIfaceNeg || isInterfaceKind) {
     ctx.save();
     ctx.strokeStyle = isPhaseActive ? '#ea580c' : '#94a3b8';
     ctx.fillStyle = isPhaseActive ? '#ea580c' : '#94a3b8';
     ctx.lineWidth = 1.8;

     const pA = pts[0], pB = pts[1];
     const segDx = pB[0] - pA[0], segDy = pB[1] - pA[1];
     const segLen = Math.hypot(segDx, segDy);
     if (segLen >= 1e-4) {
      const nx = -segDy / segLen, ny = segDx / segLen;
      const offsetPx = 6.0;

      if (hasIfacePos || isInterfaceKind) {
       ctx.setLineDash([4, 3]);
       ctx.beginPath();
       ctx.moveTo(pA[0] + offsetPx * nx, pA[1] + offsetPx * ny);
       ctx.lineTo(pB[0] + offsetPx * nx, pB[1] + offsetPx * ny);
       ctx.stroke();

       ctx.setLineDash([]);
       ctx.beginPath();
       const nTicks = Math.max(2, Math.floor(segLen / 20));
       for (let tk = 0; tk <= nTicks; tk++) {
        const frac = tk / nTicks;
        const tmx = pA[0] + frac * segDx, tmy = pA[1] + frac * segDy;
        ctx.moveTo(tmx, tmy);
        ctx.lineTo(tmx + offsetPx * nx, tmy + offsetPx * ny);
       }
       ctx.stroke();
      }

      if (hasIfaceNeg) {
       ctx.setLineDash([4, 3]);
       ctx.beginPath();
       ctx.moveTo(pA[0] - offsetPx * nx, pA[1] - offsetPx * ny);
       ctx.lineTo(pB[0] - offsetPx * nx, pB[1] - offsetPx * ny);
       ctx.stroke();

       ctx.setLineDash([]);
       ctx.beginPath();
       const nTicks = Math.max(2, Math.floor(segLen / 20));
       for (let tk = 0; tk <= nTicks; tk++) {
        const frac = tk / nTicks;
        const tmx = pA[0] + frac * segDx, tmy = pA[1] + frac * segDy;
        ctx.moveTo(tmx, tmy);
        ctx.lineTo(tmx - offsetPx * nx, tmy - offsetPx * ny);
       }
       ctx.stroke();
      }
     }
     ctx.restore();
    }
   });

   // 6. Loads & Prescribed Displacements & Hydros
   drawLoads(ctx, project.loads || [], tr, (i: number) => (mode !== 'Staged Construction' || !active || active.load?.[i] !== 0), false);
   for (const [key, color] of [['disps', '#367a57'], ['hydros', '#2788b7']] as [string, string][]) {
    const arrayKey = { disps: 'disp', hydros: 'hydro' }[key]!;
    (project[key] || []).forEach((o: Dict, i: number) => {
     if (o.x1 == null || o.y1 == null) return;
     const isPhaseActive = mode !== 'Staged Construction' || !active || active[arrayKey]?.[i] !== 0;
     const drawColor = isPhaseActive ? color : '#94a3b855';
     const a = tr(o.x1, o.y1), b = tr(o.x2 ?? o.x1, o.y2 ?? o.y1);
     ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b);
     ctx.strokeStyle = drawColor; ctx.lineWidth = 2;
     ctx.setLineDash(key === 'hydros' ? [7, 4] : []);
     ctx.stroke(); ctx.setLineDash([]);
     ctx.fillStyle = drawColor;
     ctx.beginPath(); ctx.arc(...a, 3, 0, Math.PI * 2); ctx.fill();
    });
   }
  }
  if(project.has_water&&project.wx?.length){ctx.beginPath();project.wx.forEach((x:number,i:number)=>{const p=tr(x,project.wy[i]);i?ctx.lineTo(...p):ctx.moveTo(...p)});ctx.strokeStyle='#258ec3';ctx.lineWidth=2;ctx.setLineDash([8,4]);ctx.stroke();ctx.setLineDash([])}
  if(draft.length){ctx.beginPath();draft.forEach((p,i)=>{const q=tr(...p);i?ctx.lineTo(...q):ctx.moveTo(...q)});ctx.strokeStyle='#e37332';ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.stroke();ctx.setLineDash([]);draft.forEach(p=>{ctx.fillStyle='#e37332';ctx.beginPath();ctx.arc(...tr(...p),3,0,Math.PI*2);ctx.fill()})}
  if(monitorPoint){const [mx,my]=tr(...monitorPoint);ctx.beginPath();ctx.arc(mx,my,7,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#c44f35';ctx.stroke();ctx.beginPath();ctx.moveTo(mx-10,my);ctx.lineTo(mx+10,my);ctx.moveTo(mx,my-10);ctx.lineTo(mx,my+10);ctx.stroke()}ctx.fillStyle='#596875';ctx.font='11px sans-serif';ctx.fillText(project.axisymmetric?'KATAI 2D · Axisymmetric (r-z)':'KATAI 2D · Plane strain (x-y)',w-170,h-12)

   // 5. Draw Top & Left Canvas Rulers
   const RULER_SIZE = 22;
   ctx.save();
   ctx.fillStyle = '#f8fafcee';
   ctx.fillRect(0, 0, w, RULER_SIZE);
   ctx.fillRect(0, 0, RULER_SIZE, h);
   ctx.strokeStyle = '#cbd5e1';
   ctx.lineWidth = 1;
   ctx.beginPath();
   ctx.moveTo(0, RULER_SIZE); ctx.lineTo(w, RULER_SIZE);
   ctx.moveTo(RULER_SIZE, 0); ctx.lineTo(RULER_SIZE, h);
   ctx.stroke();

   ctx.fillStyle = '#e2e8f0';
   ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);
   ctx.fillStyle = '#475569';
   ctx.font = 'bold 10px monospace';
   ctx.textAlign = 'center';
   ctx.textBaseline = 'middle';
   ctx.fillText('m', RULER_SIZE / 2, RULER_SIZE / 2);

   const targetWorldStep = 60 / base;
   const exp = Math.floor(Math.log10(Math.max(1e-6, targetWorldStep)));
   const frac = targetWorldStep / Math.pow(10, exp);
   let niceStepFrac = 1;
   if (frac >= 3.5) niceStepFrac = 5;
   else if (frac >= 1.5) niceStepFrac = 2;
   const stepM = niceStepFrac * Math.pow(10, exp);
   const subStepM = stepM / 5;

   const startX = Math.floor((-ox) / (base * stepM)) * stepM;
   const endX = Math.ceil((w - ox) / (base * stepM)) * stepM;
   ctx.font = '9px monospace';
   ctx.textAlign = 'left';
   ctx.textBaseline = 'top';

   for (let xm = startX; xm <= endX; xm += subStepM) {
    const sx = ox + xm * base;
    if (sx < RULER_SIZE || sx > w) continue;
    const isMajor = Math.abs(Math.round(xm / stepM) * stepM - xm) < 1e-5 * stepM;
    ctx.beginPath();
    ctx.moveTo(sx, isMajor ? 10 : 16);
    ctx.lineTo(sx, RULER_SIZE);
    ctx.strokeStyle = isMajor ? '#64748b' : '#cbd5e1';
    ctx.stroke();
    if (isMajor) {
     ctx.fillStyle = '#334155';
     const textVal = Number(xm.toFixed(3)).toString();
     ctx.fillText(textVal, sx + 2, 2);
    }
   }

   const startY = Math.floor((oy - h) / (base * stepM)) * stepM;
   const endY = Math.ceil(oy / (base * stepM)) * stepM;

   for (let ym = startY; ym <= endY; ym += subStepM) {
    const sy = oy - ym * base;
    if (sy < RULER_SIZE || sy > h) continue;
    const isMajor = Math.abs(Math.round(ym / stepM) * stepM - ym) < 1e-5 * stepM;
    ctx.beginPath();
    ctx.moveTo(isMajor ? 10 : 16, sy);
    ctx.lineTo(RULER_SIZE, sy);
    ctx.strokeStyle = isMajor ? '#64748b' : '#cbd5e1';
    ctx.stroke();
    if (isMajor) {
     ctx.fillStyle = '#334155';
     const textVal = Number(ym.toFixed(3)).toString();
     ctx.fillText(textVal, 2, sy - 11);
    }
   }

   if (cursorPos) {
    const [cx, cy] = cursorPos;
    const curSx = ox + cx * base;
    const curSy = oy - cy * base;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    if (curSx >= RULER_SIZE && curSx <= w) {
     ctx.beginPath(); ctx.moveTo(curSx, 0); ctx.lineTo(curSx, RULER_SIZE); ctx.stroke();
    }
    if (curSy >= RULER_SIZE && curSy <= h) {
     ctx.beginPath(); ctx.moveTo(0, curSy); ctx.lineTo(RULER_SIZE, curSy); ctx.stroke();
    }
   }
   ctx.restore();
 },[canvasTransform,resize,project,mesh,activeResult,grid,draft,resultField,bounds,showArrows,vectorDir,showContours,showMeshLines,showDeformed,deformScale,activeStrains,monitorPoint,dropHighlight,tab,phase,mode,active,outputView,structForceType,structDiagScale,selectedStructIdx,cursorPos])
 function screenToWorld(cx:number,cy:number):Point{const t=canvasTransform()!;let x=(cx-t.ox)/t.base,y=(t.oy-cy)/t.base;const step=Number(project.mesh?.elem_size)||.25;if(snap&&tab==='Model'){x=Math.round(x/step)*step;y=Math.round(y/step)*step}return [Number(x.toFixed(4)),Number(y.toFixed(4))]}
 function canvasDown(e:ReactPointerEvent<HTMLCanvasElement>){
  const r=e.currentTarget.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  if(tool==='pan'||e.button===1){
   e.preventDefault();
   try{(e.currentTarget as any).setPointerCapture?.(e.pointerId)}catch{}
   view.current.drag={x,y,px:view.current.panX,py:view.current.panY};
   return;
  }
  if(tab==='Output'){
   if(e.button===0){
    const point=screenToWorld(x,y);
    const structs=project.structs||[];
    let foundStructIdx=-1;
    for(let i=structs.length-1;i>=0;i--){
     const s=structs[i];
     if(s.x1!=null){
      const dx=Number(s.x2??s.x1)-s.x1, dy=Number(s.y2??s.y1)-s.y1, length2=dx*dx+dy*dy;
      const t=length2?Math.max(0,Math.min(1,((point[0]-s.x1)*dx+(point[1]-s.y1)*dy)/length2)):0;
      if(Math.hypot(point[0]-(s.x1+t*dx), point[1]-(s.y1+t*dy))<0.35){
       foundStructIdx=i;
       break;
      }
     }
    }
    if(foundStructIdx!==-1){
     setSelectedStructIdx(foundStructIdx);
     setOutputView('structures');
     setNotice(`Structure ${foundStructIdx+1} (${structs[foundStructIdx]?.name||'Structure'}) selected`);
     return;
    }
    const m=activeResult?.mesh;
    if(m&&m.node_count>0){
     let nearestNode=-1, minDist=0.35;
     const dTot=(activeResult.displacement_total&&activeResult.displacement_total.length)?activeResult.displacement_total:(activeResult.displacement||[]);
     const effScale=showDeformed?(Number(deformScale)||0):0;
     for(let i=0;i<m.node_count;i++){
      const nx=m.x[i]+(dTot[i*2]||0)*effScale;
      const ny=m.y[i]+(dTot[i*2+1]||0)*effScale;
      const dist=Math.hypot(point[0]-nx, point[1]-ny);
      if(dist<minDist){
       minDist=dist;
       nearestNode=i;
      }
     }
     if(nearestNode!==-1){
      const ux=((dTot[nearestNode*2]||0)*1000).toFixed(2);
      const uy=((dTot[nearestNode*2+1]||0)*1000).toFixed(2);
      const utot=(Math.hypot(dTot[nearestNode*2]||0, dTot[nearestNode*2+1]||0)*1000).toFixed(2);
      setNotice(`Node #${nearestNode+1} (${m.x[nearestNode].toFixed(2)}, ${m.y[nearestNode].toFixed(2)} m) · |u|=${utot} mm (ux=${ux}, uy=${uy} mm)`);
      return;
     }
    }
    e.preventDefault();
    try{(e.currentTarget as any).setPointerCapture?.(e.pointerId)}catch{}
    view.current.drag={x,y,px:view.current.panX,py:view.current.panY};
   }
   return;
  }
  if(tool==='monitor'){const point=screenToWorld(x,y);setMonitorPoint(point);setTool('select');setNotice(`Monitor point selected at (${point[0]}, ${point[1]}) m`);return}if(tool==='borehole'){const point=screenToWorld(x,y),obj=emptyEntity('boreholes',project);obj.x=point[0];obj.level=bounds.ymax;obj.has_head=Boolean(project.has_water);obj.head=project.has_water?Number(project.wy?.[0]||0):0;setProjectSafe({...project,boreholes:[...project.boreholes,obj]});setSelected({key:'boreholes',index:project.boreholes.length});setDraft([]);setMode('Soil');setNotice('Borehole added to model');return}if(['polygon','rectangle','structure','load','disp','hydro','water'].includes(tool)){const point=screenToWorld(x,y);if(tool==='rectangle'&&draft.length){const [a,b]=[draft[0],point];commitDraft([[a[0],a[1]],[b[0],a[1]],[b[0],b[1]],[a[0],b[1]]]);setTool('select')}else setDraft(prev=>[...prev,point]);return}const point=screenToWorld(x,y);let found:{key:string,index:number}|null=null;for(const key of ['polygons','structs','loads','disps','hydros']){const list=project[key]||[];for(let i=list.length-1;i>=0;i--){const p=list[i];if(p.x&&Math.min(...p.x)<=point[0]&&point[0]<=Math.max(...p.x)&&Math.min(...p.y)<=point[1]&&point[1]<=Math.max(...p.y)){found={key,index:i};break}if(p.x1!=null){const dx=Number(p.x2??p.x1)-p.x1,dy=Number(p.y2??p.y1)-p.y1,length2=dx*dx+dy*dy,t=length2?Math.max(0,Math.min(1,((point[0]-p.x1)*dx+(point[1]-p.y1)*dy)/length2)):0;if(Math.hypot(point[0]-(p.x1+t*dx),point[1]-(p.y1+t*dy))<.15){found={key,index:i};break}}}if(found)break}if(mode==='Staged Construction'&&found&&(selected?.key==='initial'||selected?.key==='phases')&&active){const mapKey:Record<string,string>={polygons:'poly',loads:'load',structs:'struct',disps:'disp',hydros:'hydro'};const arrayKey=mapKey[found.key];if(arrayKey){const list=project[found.key]||[];const defVal=['disps','hydros'].includes(found.key)?0:1;const arr=[...(active[arrayKey]||[])];while(arr.length<list.length)arr.push(defVal);arr[found.index]=arr[found.index]?0:1;setActive({...active,[arrayKey]:arr});setNotice(`Toggled ${project[found.key][found.index].name||found.key} (${arr[found.index]?'Aktif':'Non-aktif'})`);return}}setSelected(found);if(found)setMode(found.key==='structs'||found.key==='loads'||found.key==='disps'?'Structures':found.key==='hydros'?'Flow Conditions':'Soil')}
 function canvasMove(e:ReactPointerEvent<HTMLCanvasElement>){
  const r=e.currentTarget.getBoundingClientRect();
  const rawX=e.clientX-r.left, rawY=e.clientY-r.top;
  const t=canvasTransform();
  if(t){
   const wx=(rawX-t.ox)/t.base, wy=(t.oy-rawY)/t.base;
   setCursorPos([Number(wx.toFixed(3)), Number(wy.toFixed(3))]);
  }
  if(!view.current.drag)return;
  const d=view.current.drag;
  view.current.panX=d.px+(rawX-d.x);
  view.current.panY=d.py+(rawY-d.y);
  setResize(n=>n+1);
 }
 function canvasUp(e?:ReactPointerEvent<HTMLCanvasElement>){if(e){try{(e.currentTarget as any).releasePointerCapture?.(e.pointerId)}catch{}}view.current.drag=null}
 function canvasLeave(){view.current.drag=null;setCursorPos(null)}
 function commitDraft(points:Point[]):Point[]{if(points.length<2)return points;if(tool==='water'){setProjectSafe({...project,has_water:true,wx:points.map(p=>p[0]),wy:points.map(p=>p[1])});setSelected({key:'project',index:0});setDraft([]);setMode('Flow Conditions');setNotice('Groundwater boundary updated');return []}const key=tool==='polygon'||tool==='rectangle'?'polygons':tool==='structure'?'structs':tool==='load'?'loads':tool==='disp'?'disps':'hydros';let obj=emptyEntity(key,project);if(key==='polygons'){obj.x=points.map(p=>p[0]);obj.y=points.map(p=>p[1]);obj.material=0;obj.coarseness=1;obj.edge_bc=points.map(()=>0);obj.edge_flow=points.map(()=>0);obj.edge_head=points.map(()=>0);obj.edge_flux=points.map(()=>0)}else {obj.x1=points[0][0];obj.y1=points[0][1];obj.x2=points[1][0];obj.y2=points[1][1];obj.coarseness=0.25;if(key==='structs')obj.kind=structKindRef.current??0;if(key==='loads'){obj.kind=1;obj.qy1=-100;obj.qy2=-100}if(key==='hydros'){obj.kind=0;obj.head=0;obj.coarseness=0.25}}setProjectSafe({...project,[key]:[...(project[key]||[]),obj]});setSelected({key,index:(project[key]||[]).length});setDraft([]);setMode(key==='hydros'?'Flow Conditions':key==='polygons'?'Soil':'Structures');setNotice(`${fmt(key)} added to model`);return []}
 function finishDraft(){if(tab==='Output')return;const points=draft.filter((p,i)=>i===0||Math.hypot(p[0]-draft[i-1][0],p[1]-draft[i-1][1])>1e-8);if(tool==='polygon'&&points.length>=3){commitDraft(points);setTool('select')}else if(points.length>=2){commitDraft(points);setTool('select')}}
 function addEntity(key:string){const item=key==='initial'?{...project.initial,name:'Initial phase'}:emptyEntity(key,project);if(key==='initial'){setSelected({key,index:0});setMode('Staged Construction');return}const idx=(project[key]||[]).length;setProjectSafe({...project,[key]:[...(project[key]||[]),item]});setSelected({key,index:idx});setNotice(`${fmt(key)} added`)}
 function removeSelected(){if(!selected)return;if(selected.key==='project')return;if(selected.key==='initial'){setSelected(null);return}setProjectSafe({...project,[selected.key]:project[selected.key].filter((_:unknown,i:number)=>i!==selected.index)});setSelected(null)}
 function zoom(v:number){view.current.zoom=Math.max(.25,Math.min(8,view.current.zoom*v));setScale(view.current.zoom);setResize(n=>n+1)}
 const menuItems:Record<string,[string,()=>unknown][]>= {
  File:[['New project',()=>create()],['Save project',save],['Export .k2d',exportFile],['Browse presets...',()=>setPresetModalOpen(true)],['Tutorial 1 · rigid footing',()=>loadExample('/examples/tutorial1-rigid.k2d')],['Tutorial 1 · flexible footing',()=>loadExample('/examples/tutorial1-flexible.k2d')]],
  Studies:[['Browse all studies & presets...',()=>setPresetModalOpen(true)],...studyExamples.map(example=>[example.project.name,()=>loadExample(example.project)] as [string,()=>unknown])],
  Examples:corpusExamples.map(example=>[example.project.name,()=>loadExample(example.project)]),
  Edit:[['Undo',()=>moveHistory(-1)],['Redo',()=>moveHistory(1)],['Delete selected object',removeSelected]],
  View:[['Toggle grid',()=>setGrid(!grid)],['Toggle mesh lines',()=>setShowMeshLines(!showMeshLines)],['Toggle snap',()=>setSnap(!snap)],['Fit model',()=>{view.current.zoom=1;view.current.panX=0;view.current.panY=0;setResize(n=>n+1)}]],
  Tools:[['Validate model',validate],['Generate mesh',generateMesh],['Calculate',calculate]],
  Help:[['About KATAI 2D',()=>setHelpOpen(true)]],
 }
 function changeField(path:string[],value:any){if(!selected)return;const obj=clone(active);let target=obj;for(const p of path.slice(0,-1))target=target[p];target[path[path.length-1]]=value;setActive(obj)}
 const objectFields=selected?.key==='project'?schema.properties:entitySchema(selected?.key||'');
 function renderFields(obj:Dict,props:Dict,path:string[]=[]){return Object.entries(props||{}).filter(([k])=>k in obj||!['katai2d'].includes(k)).map(([key,schemaProp]:[string,any])=>{const spec=resolveProp(schemaProp);const val=obj[key]===undefined?('default'in spec?clone(spec.default):spec.type==='string'?'':spec.type==='boolean'?false:spec.type==='array'?[]:spec.type==='object'?{}:spec.type==='number'||spec.type==='integer'?(spec.enum?.[0]??''):undefined):obj[key];if(val===undefined)return null;const pathNext=[...path,key];if(Array.isArray(val)){if(val.length&&typeof val[0]==='object')return <div className="nested" key={key}><b>{fmt(key)}</b>{val.map((item:Dict,i:number)=><details key={i}><summary>{item.name||`${fmt(key)} ${i+1}`}</summary>{renderFields(item,entitySchema(key),[...pathNext,String(i)])}</details>)}</div>;return <label className="field" key={key}><span>{fmt(key)}</span><input value={val.join(', ')} onChange={e=>changeArray(pathNext,e.target.value)} placeholder="comma separated"/></label>}if(val&&typeof val==='object'){return <details className="nested" key={key} open><summary>{fmt(key)}</summary>{renderFields(val,propsFor(schemaProp),pathNext)}</details>}if(typeof val==='boolean')return <label className="checkfield" key={key}><input type="checkbox" checked={val} onChange={e=>changeField(pathNext,e.target.checked)}/><span>{fmt(key)}</span></label>;const isNum=typeof val==='number'||spec.type==='number'||spec.type==='integer';const enumValues=schemaProp?.enum;return <label className="field" key={key}><span>{fmt(key)}</span>{enumValues?<select value={val} onChange={e=>changeField(pathNext,Number(e.target.value))}>{enumValues.map((n:number)=><option key={n} value={n}>{n} · {enumCaption(key,n)}</option>)}</select>:<input type={isNum?'number':'text'} step={isNum?'any':undefined} value={val??''} onChange={e=>changeField(pathNext,isNum?(e.target.value===''?0:Number(e.target.value)):e.target.value)}/>}</label>})}
 function changeArray(path:string[],txt:string){changeField(path,txt.split(',').map(x=>x.trim()).filter(Boolean).map(Number))}
 function enumCaption(key:string,n:number){const names:Record<string,string[]>={model:['Linear Elastic (LE)','Mohr-Coulomb (MC)','Hardening Soil (HS)','HS-Small (HSS)','Soft Soil (SS)','Soft Soil Creep (SSC)','Hoek-Brown (HB)','Modified Cam-Clay (MCC)','NGI-ADP Anisotropic','Jointed Rock (JR)'],drainage:['Drained','Undrained (A)','Non-porous','Undrained (B)','Undrained (C)'],kind:['Plate','Anchor','Geogrid','Embedded beam','Interface'],type:['Plastic (Staged construction)','Safety (Phi-c reduction)','Consolidation','Transient flow','Fully coupled','Dynamic (Seismic)'],initial_procedure:['K0 Procedure (Jaky / Explicit)','Gravity Loading','Direct Safety (Phi-c Reduction)','Groundwater Flow Only'],design:['None (characteristic)','Eurocode 7 - DA1 Comb. 1','Eurocode 7 - DA1 Comb. 2','Eurocode 7 - DA2','Eurocode 7 - DA3','TBDY 2018 (Static)','TBDY 2018 (Seismic)'],edge_flow:['Closed (impermeable)','Prescribed head','Seepage face','Prescribed flux'],edge_bc:['Free','Normally fixed','Horizontally fixed','Vertically fixed','Fully fixed']};return names[key]?.[n]||`Value ${n}`}
 function forceDiagram(stations:Dict[],field:string){if(!stations?.length)return null;const values=stations.map(s=>Number(s[field]||0)),max=Math.max(1e-12,...values.map(Math.abs)),points=values.map((v,i)=>`${8+i*184/Math.max(1,values.length-1)},${34-v/max*26}`).join(' ');return <svg viewBox="0 0 200 40" className="forcediagram" role="img" aria-label={`${field} force diagram`}><line x1="5" y1="34" x2="195" y2="34" stroke="#cad4dc"/><polyline points={points} fill="none" stroke="#b04f39" strokeWidth="1.8"/><text x="5" y="10">{field} · ±{max.toPrecision(3)}</text></svg>}

 const filteredPresets=useMemo(()=>{
  return allPresets.filter(p=>{
   const matchCat=presetCategory==='All'||p.category===presetCategory
   const matchSearch=!presetSearch||p.project.name.toLowerCase().includes(presetSearch.toLowerCase())||p.filename.toLowerCase().includes(presetSearch.toLowerCase())
   return matchCat&&matchSearch
  })
 },[presetCategory,presetSearch])

 if(!authorized)return <div className="auth"><div className="authcard"><div className="brandmark">K</div><h1>KATAI 2D</h1><p>Geotechnical finite element analysis</p><form onSubmit={authorize}><label>Owner access token<input autoFocus type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="Enter server access token"/></label><button className="primary">Connect</button></form><small>{notice}</small></div></div>
 return <div className="app"><header className="titlebar"><div className="brand"><span className="brandmark small">K</span><span>KATAI 2D</span><i>GEOTECHNICAL ANALYSIS</i></div><div className="titlecenter">{project.name||'Untitled project'} <span>— {tab==='Output'?'Output':'Input'}</span></div><div className="titleactions"><button title="Help" onClick={()=>setHelpOpen(true)}><CircleHelp size={16}/></button><span className="userbadge">OWNER</span></div></header>
  <nav className="menubar">{['File','Studies','Examples','Edit','View','Tools','Help'].map(m=><div className="menuposition" key={m}><button onClick={()=>setOpenMenu(openMenu===m?'':m)}>{m}</button>{openMenu===m&&<div className="menupopup">{menuItems[m].map(([label,fn]:any)=><button key={label} onClick={()=>{setOpenMenu('');fn()}}>{label}</button>)}</div>}</div>)}<div className="quick"><button onClick={()=>setPresetModalOpen(true)} title="Browse all presets & studies"><FolderOpen/> Presets</button><button onClick={()=>create()} title="New project"><FilePlus2/></button><label title="Open .k2d"><Upload/><input type="file" accept=".k2d,.json,application/json" onChange={openFile}/></label><button onClick={save} title="Save"><Save/></button><button onClick={exportFile} title="Export .k2d"><Download/></button><span className="sep"/><button title="Undo" onClick={()=>moveHistory(-1)}><Undo2/></button><button title="Redo" onClick={()=>moveHistory(1)}><Redo2/></button><span className="sep"/><button onClick={validate} title="Validate"><Check/></button><button className="run" onClick={calculate} disabled={!!job&&['queued','running','cancelling'].includes(job.status)} title="Calculate"><Play size={15} fill="currentColor"/> Calculate</button></div><div className="saved"><span className="live-dot"/> {projectId?'Server project':'Unsaved'}</div></nav>
  <div className="ribbon"><div className="shellswitch"><button className={tab==='Model'?'on':''} onClick={()=>setTab('Model')}><Layers size={15}/> Input</button><button className={tab==='Output'?'on':''} onClick={()=>{setDraft([]);setTab('Output');if(!results.length)loadResults()}}><ChartNoAxesCombined size={15}/> Output</button></div>{tab==='Model'?<><div className="ribbon-group"><span>Mode</span><div className="mode-buttons">{modes.map(m=><button key={m} className={mode===m?'selected':''} onClick={()=>{setMode(m);if(m==='Mesh'){setSelected({key:'mesh',index:0})}else if(m==='Staged Construction'&&(!selected||(selected.key!=='initial'&&selected.key!=='phases'))){setSelected(project.phases?.length?{key:'phases',index:0}:{key:'initial',index:0})}}}>{m}</button>)}</div></div><button className={`outline axisym-toggle ${project.axisymmetric?'axisym-on':''}`} onClick={()=>setProjectSafe({...project,axisymmetric:!project.axisymmetric})} title="Toggle Axisymmetric analysis (r-z) vs Plane Strain (x-y)"><Activity size={14}/> {project.axisymmetric?'Axisymmetric (r-z)':'Plane Strain (x-y)'}</button><div className="ribbon-tools compact"><button className={grid?'selected':''} onClick={()=>setGrid(!grid)} title="Grid"><Grid2X2/></button><button className={snap?'selected':''} onClick={()=>setSnap(!snap)} title="Snap"><Crosshair/></button><button onClick={()=>zoom(1.2)} title="Zoom in"><ZoomIn/></button><button onClick={()=>zoom(.83)} title="Zoom out"><ZoomOut/></button><button onClick={()=>{view.current.zoom=1;view.current.panX=0;view.current.panY=0;setScale(1);setResize(n=>n+1)}} title="Fit model"><Ruler/></button></div></>:<><div className="ribbon-group"><span>View</span><div className="output-view-toggle"><button type="button" className={`output-view-btn ${outputView==='mesh'?'active':''}`} onClick={()=>setOutputView('mesh')}>Soil & Mesh</button><button type="button" className={`output-view-btn ${outputView==='structures'?'active':''}`} onClick={()=>{setOutputView('structures');applyStructAutoScale(structForceType)}}>Structure Forces</button></div></div><div className="ribbon-group"><span>Phase</span><select className="output-select" value={phase} onChange={e=>setPhase(Number(e.target.value))}>{results.map((p,i)=><option key={i} value={i}>{`${i+1} · ${p.name}`}</option>)}</select></div>{outputView==='structures'?(<><div className="ribbon-group"><span>Component</span><select className="output-select" value={structForceType} onChange={e=>{const val=e.target.value as 'M'|'Q'|'N'|'u';setStructForceType(val);applyStructAutoScale(val)}}><option value="M">Bending Moment M [kNm/m]</option><option value="Q">Shear Force Q [kN/m]</option><option value="N">Axial Force N [kN/m]</option><option value="u">Displacement |u| [mm]</option></select></div>{(activeResult?.struct_forces||[]).length>1&&<div className="ribbon-group"><span>Structure</span><select className="output-select" value={selectedStructIdx} onChange={e=>setSelectedStructIdx(Number(e.target.value))}><option value={-1}>All structures</option>{(activeResult?.struct_forces||[]).map((sf:Dict,i:number)=><option key={i} value={i}>{sf.name||`Structure ${i+1}`}</option>)}</select></div>}<div className="ribbon-group"><span>Diagram Scale</span><div className="deform-scale-group"><input type="number" step="any" min="0" className="deform-scale-input" value={structDiagScale} onChange={e=>setStructDiagScale(Math.max(0,parseFloat(e.target.value)||0))} title="Custom diagram scale factor"/><select className="deform-scale-select" value={[0.001,0.005,0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10,50].includes(structDiagScale)?structDiagScale:'custom'} onChange={e=>{if(e.target.value!=='custom')setStructDiagScale(Number(e.target.value))}}><option value="0.001">0.001x</option><option value="0.005">0.005x</option><option value="0.01">0.010x</option><option value="0.02">0.020x</option><option value="0.05">0.050x</option><option value="0.1">0.100x</option><option value="0.2">0.200x</option><option value="0.5">0.500x</option><option value="1">1.000x</option><option value="5">5.000x</option><option value="10">10.00x</option><option value="50">50.00x</option><option value="custom" disabled hidden>Custom</option></select><button type="button" className="deform-scale-auto-btn" onClick={()=>applyStructAutoScale(structForceType)} title="Auto-scale diagram to visible size">Auto</button></div></div></>):(<><div className="ribbon-group"><span>Result field</span><select className="output-select" value={resultField} onChange={e=>setResultField(e.target.value)}>{outputGroups.filter(g=>g.id!=='structure-forces').flatMap(g=>g.fields).map(x=><option key={x} value={x}>{x}</option>)}</select></div><div className="ribbon-group"><span>Mesh</span><div className="mesh-toggle-group"><button type="button" className={`mesh-toggle-btn ${!showDeformed?'active':''}`} onClick={()=>setShowDeformed(false)}>Undeformed</button><button type="button" className={`mesh-toggle-btn ${showDeformed?'active':''}`} onClick={()=>setShowDeformed(true)}>Deformed</button></div></div>{showDeformed&&<div className="ribbon-group"><span>Scale</span><div className="deform-scale-group"><input type="number" step="any" min="0" className="deform-scale-input" value={deformScale} onChange={e=>setDeformScale(Math.max(0,parseFloat(e.target.value)||0))} title="Custom scale factor" /><select className="deform-scale-select" value={[1,5,10,20,50,100,200,500].includes(deformScale)?deformScale:'custom'} onChange={e=>{if(e.target.value!=='custom')setDeformScale(Number(e.target.value))}}><option value="1">1x</option><option value="5">5x</option><option value="10">10x</option><option value="20">20x</option><option value="50">50x</option><option value="100">100x</option><option value="200">200x</option><option value="500">500x</option><option value="custom" disabled hidden>Custom</option></select><button type="button" className="deform-scale-auto-btn" onClick={applyAutoScale} title="Auto-scale deformation to visible magnitude">Auto</button></div></div>}<div className="ribbon-tools compact"><button className={showMeshLines?'selected':''} onClick={()=>setShowMeshLines(!showMeshLines)} title="Toggle mesh lines"><Grid2X2/></button><button className={showContours?'selected':''} onClick={()=>setShowContours(!showContours)} title="Toggle contour lines"><Activity/></button><button className={showArrows?'selected':''} onClick={()=>setShowArrows(!showArrows)} title="Toggle displacement arrows"><Crosshair/></button>{showArrows&&<div className="vdir-ribbon-group" title="Arah vektor perpindahan"><button type="button" className={`vdir-ribbon-btn ${vectorDir==='total'?'active':''}`} onClick={()=>setVectorDir('total')}>Total</button><button type="button" className={`vdir-ribbon-btn ${vectorDir==='x'?'active':''}`} onClick={()=>setVectorDir('x')}>X</button><button type="button" className={`vdir-ribbon-btn ${vectorDir==='y'?'active':''}`} onClick={()=>setVectorDir('y')}>Y</button></div>}</div></>)}<button className="outline" onClick={()=>loadResults()}>Refresh results</button></>}</div>
  <div className="workspace"><aside className="explorer"><div className="pane-title"><div style={{display:'flex',alignItems:'center',gap:6}}><Activity size={14} style={{color:'#2563eb'}}/><span>{tab==='Output'?'OUTPUT EXPLORER':'PROJECT EXPLORER'}</span></div><button onClick={()=>setTreeOpen(!treeOpen)} title="Toggle panel"><PanelLeftClose size={14}/></button></div>{tab==='Output'&&treeOpen&&(
   <div className="output-sidebar">
    <div className="output-phase-picker">
     <span className="output-phase-title">CALCULATION PHASE</span>
     <select className="output-phase-select" value={phase} onChange={e=>setPhase(Number(e.target.value))}>
      {results.length>0?results.map((p,i)=><option key={i} value={i}>{`[ph${i}] ${p.name||(i===0?'Initial phase':`Phase_${i}`)}`}</option>):<option value={0}>[ph0] Initial phase</option>}
     </select>
    </div>
    <div className="output-groups-scroll tree">
     {outputGroups.map(group=>{
      const toggleActive=group.toggleKey==='arrows'?showArrows:false;
      const onToggle=group.toggleKey==='arrows'?()=>setShowArrows(!showArrows):()=>{};
      return (
       <div key={group.name} className={`output-group-block group-${group.id}`}>
        <div className="treefolder output-group-title">
         <ChevronRight size={13}/>
         <span>{group.name}</span>
        </div>
        <div className="output-fields-list">
         {group.fields.map(field=>{
          const isSelected = outputView === 'structures'
           ? (group.id === 'structure-forces' && (
               (structForceType === 'M' && field.includes('Bending Moment')) ||
               (structForceType === 'Q' && field.includes('Shear Force')) ||
               (structForceType === 'N' && field.includes('Axial Force')) ||
               (structForceType === 'u' && field.includes('Displacement'))
             ))
           : (resultField===field||(
               (field.startsWith('Displacement Increments')&&resultField==='Displacement magnitude')||
               (field.startsWith('Total Displacement')&&resultField==='Total displacement')||
               (field.startsWith('Horizontal Displacement')&&resultField==='Horizontal displacement')||
               (field.startsWith('Vertical Displacement')&&resultField==='Vertical displacement')||
               (field.startsWith("Cartesian Effective Stress")&&resultField==='σyy')||
               (field.startsWith("Horizontal Effective Stress")&&resultField==='σxx')||
               (field.startsWith("Shear Stress")&&resultField==='τxy')||
               (field.startsWith("Active Pore Pressure")&&resultField==='Pore pressure')
             ));
          return (
           <button key={field} className={`treeitem output-field-btn ${isSelected?'active':''}`} onClick={()=>{
            setResultField(field);
            if(group.id==='structure-forces'){
             setOutputView('structures');
             let ft:'M'|'Q'|'N'|'u'='M';
             if(field.includes('Shear Force'))ft='Q';
             else if(field.includes('Axial Force'))ft='N';
             else if(field.includes('Displacement'))ft='u';
             setStructForceType(ft);
             applyStructAutoScale(ft);
            }else{
             setOutputView('mesh');
            }
           }}>
            <span className="treecolor" style={{background:group.color}}/>
            <span className="treeitem-text">{field}</span>
           </button>
          );
         })}
        </div>
        {group.toggleLabel&&(
         <div style={{padding:'2px 8px 4px 20px'}}>
          <div className={`output-vector-pill pill-${group.id}`} onClick={onToggle}>
           <span>{group.toggleLabel}</span>
           <span className={`pill-badge ${toggleActive?'on':'off'}`}>{toggleActive?'ON':'OFF'}</span>
          </div>
          {group.id==='deformations'&&showArrows&&(
           <div className="output-vector-dirs" data-testid="vector-dir-selector">
            <button type="button" className={`vdir-btn ${vectorDir==='total'?'active':''}`} onClick={()=>setVectorDir('total')}>Total</button>
            <button type="button" className={`vdir-btn ${vectorDir==='x'?'active':''}`} onClick={()=>setVectorDir('x')}>Arah X</button>
            <button type="button" className={`vdir-btn ${vectorDir==='y'?'active':''}`} onClick={()=>setVectorDir('y')}>Arah Y</button>
           </div>
          )}
         </div>
        )}
       </div>
      );
     })}
    </div>
   </div>
  )}{tab==='Model'&&treeOpen&&(<>
   <button className={`projectlabel ${selected?.key==='project'?'project-active':''}`} onClick={()=>setSelected({key:'project',index:0})}><Box size={15}/><span>{project.name||'Untitled project'}</span></button>
   <div className="tree">{mode==='Staged Construction'?(
    <div>
     <div className="treefolder"><ChevronRight size={13}/><span>Calculation phases</span><button onClick={()=>addEntity('phases')} title="Add"><Plus size={14}/></button></div>
     <button className={`treeitem phase-tree-item ${selected?.key==='initial'?'active':''}`} onClick={()=>setSelected({key:'initial',index:0})} aria-label="Initial phase">
      <span className="treecolor" style={{background:'#64748b'}}/>
      <span className="phase-tree-label">0. Initial Phase</span>
      <span className="phase-badge-pill phase-badge-gravity">{['K0','Gravity','Safety','Flow'][project.initial_procedure??1]||'Gravity'}</span>
     </button>
     {(project.phases||[]).map((p:Dict,i:number)=>{
      const typeNum=Number(p.type??0);
      const typeBadgeMap:Record<number,{label:string,cls:string}>={
       0:{label:'Plastic',cls:'phase-badge-plastic'},
       1:{label:'Safety',cls:'phase-badge-safety'},
       2:{label:'Consol',cls:'phase-badge-consol'},
       3:{label:'Flow',cls:'phase-badge-flow'},
       4:{label:'Coupled',cls:'phase-badge-coupled'},
       5:{label:'Dynamic',cls:'phase-badge-dynamic'}
      };
      const badge=typeBadgeMap[typeNum]||{label:'Plastic',cls:'phase-badge-plastic'};
      const isSelected=selected?.key==='phases'&&selected.index===i;
      return <button key={i} className={`treeitem phase-tree-item ${isSelected?'active':''}`} onClick={()=>setSelected({key:'phases',index:i})}>
       <span className="treecolor" style={{background:colors[i%colors.length]}}/>
       <span className="phase-tree-label">{`${i+1}. ${p.name||`Phase ${i+1}`}`}</span>
       <span className={`phase-badge-pill ${badge.cls}`}>{badge.label}</span>
       <span className="phase-trash-btn" title="Hapus phase" onClick={e=>{
        e.stopPropagation();
        const newPhases=(project.phases||[]).filter((_:any,idx:number)=>idx!==i);
        setProjectSafe({...project,phases:newPhases});
        if(selected?.key==='phases'&&selected.index===i){
         setSelected(newPhases.length?{key:'phases',index:Math.max(0,i-1)}:{key:'initial',index:0});
        }
       }}><Trash2 size={12}/></span>
      </button>
     })}
    </div>
   ):(
    currentArrays.map(key=><div key={key}><div className="treefolder"><ChevronRight size={13}/><span>{labels[key]||fmt(key)}</span>{['Mesh settings','Groundwater'].includes(key)?null:<button onClick={()=>addEntity(key==='initial'?'initial':key)} title="Add"><Plus size={14}/></button>}</div>{key==='Mesh settings'?<button className={`treeitem ${selected?.key==='mesh'?'active':''}`} onClick={()=>setSelected({key:'mesh',index:0})}>Edit mesh settings</button>:key==='Groundwater'?<button className="treeitem" onClick={()=>setSelected({key:'project',index:0})}>Edit water boundary</button>:key==='initial'?<button className={`treeitem ${selected?.key==='initial'?'active':''}`} onClick={()=>setSelected({key:'initial',index:0})}>Initial phase</button>:(project[key]||[]).map((o:Dict,i:number)=><button key={i} draggable={['materials','plates','anchors','geogrids','embedded'].includes(key)} onDragStart={e=>{if(key==='materials'){e.dataTransfer.setData('text/katai-material',String(i));e.dataTransfer.setData('text/plain',o.name||`Material ${i+1}`)}else{e.dataTransfer.setData('text/katai-struct-mat',JSON.stringify({key,index:i}));e.dataTransfer.setData('text/plain',o.name||`${fmt(key)} ${i+1}`)}}} className={`treeitem ${['materials','plates','anchors','geogrids','embedded'].includes(key)?'draggable-item':''} ${selected?.key===key&&selected.index===i?'active':''}`} onClick={()=>setSelected({key,index:i})} title={['materials','plates','anchors','geogrids','embedded'].includes(key)?'Drag onto canvas to assign material':undefined}><span className="treecolor" style={{background:colors[i%colors.length]}}/>{o.name||`${fmt(key)} ${i+1}`}</button>)}{key==='phases'&&(project.phases||[]).map((p:Dict,i:number)=><button key={`p${i}`} className={`treeitem ${selected?.key==='phases'&&selected.index===i?'active':''}`} onClick={()=>setSelected({key:'phases',index:i})}>{p.name||`Phase ${i+1}`}</button>)}</div>)
   )}</div>
  </>)}</aside>
   <main className="drawing"><div className="viewtabs"><div className="viewtab active">{tab==='Output'?(outputView==='structures'?'Structure Forces Diagram':'Calculation Results'):(mode==='Mesh'?'Mesh View':'Model Geometry')}</div><div className="viewtools"><button title="Toggle grid" onClick={()=>setGrid(!grid)}><Grid2X2/></button><span>{Math.round(scale*100)}%</span></div></div><div className="drawing-body">{tab==='Model'&&(
    <div className="cad-toolbar">
     {/* 1. Select Pointer */}
     <button className={`cad-tool-btn ${tool==='select'?'active':''}`} onClick={()=>{setTool('select');setDraft([])}} title="Select tool (Pointer)"><MousePointer2 size={18} style={{color:tool==='select'?'#fff':'#334155'}}/></button>
     {/* 2. Pan Hand */}
     <button className={`cad-tool-btn ${tool==='pan'?'active':''}`} onClick={()=>{setTool('pan');setDraft([])}} title="Pan view (Drag canvas)"><Move size={18} style={{color:tool==='pan'?'#fff':'#334155'}}/></button>
     <div className="cad-tool-sep"/>

     {/* Tab-specific tool icons */}
     {mode==='Soil'&&(
      <>
       <button className={`cad-tool-btn ${tool==='borehole'?'active':''}`} onClick={()=>{setTool('borehole');setDraft([])}} title="Toolbar: Stratum Borehole"><Layers size={18} style={{color:tool==='borehole'?'#fff':'#c25e00'}}/></button>
       <button className={`cad-tool-btn ${tool==='polygon'?'active':''}`} onClick={()=>{setTool('polygon');setDraft([])}} title="Toolbar: Soil Region"><Square size={18} style={{color:tool==='polygon'?'#fff':'#c25e00'}}/></button>
       <button className={`cad-tool-btn ${tool==='rectangle'?'active':''}`} onClick={()=>{setTool('rectangle');setDraft([])}} title="Toolbar: Soil Box"><Square size={18} style={{color:tool==='rectangle'?'#fff':'#ea580c',strokeWidth:2.5}}/></button>
       <button className={`cad-tool-btn ${tool==='water'?'active':''}`} onClick={()=>{setTool('water');setDraft([])}} title="Toolbar: Phreatic Water Boundary"><Droplets size={18} style={{color:tool==='water'?'#fff':'#0891b2'}}/></button>
      </>
     )}

     {mode==='Structures'&&(
      <>
       <button className={`cad-tool-btn btn-plate ${tool==='structure'&&structKind===0?'active':''}`} onClick={()=>{structKindRef.current=0;setStructKind(0);setTool('structure');setDraft([])}} title="Toolbar: Plate Structure">I</button>
       <button className={`cad-tool-btn ${tool==='structure'&&structKind===2?'active':''}`} onClick={()=>{structKindRef.current=2;setStructKind(2);setTool('structure');setDraft([])}} title="Toolbar: Geogrid Element"><Grid2X2 size={18} style={{color:tool==='structure'&&structKind===2?'#fff':'#059669'}}/></button>
       <button className={`cad-tool-btn ${tool==='structure'&&structKind===4?'active':''}`} onClick={()=>{structKindRef.current=4;setStructKind(4);setTool('structure');setDraft([])}} title="Toolbar: Joint Interface"><Scissors size={18} style={{color:tool==='structure'&&structKind===4?'#fff':'#d97706'}}/></button>
       <button className={`cad-tool-btn ${tool==='structure'&&structKind===1?'active':''}`} onClick={()=>{structKindRef.current=1;setStructKind(1);setTool('structure');setDraft([])}} title="Toolbar: Ground Anchor"><Anchor size={18} style={{color:tool==='structure'&&structKind===1?'#fff':'#7c3aed'}}/></button>
       <button className={`cad-tool-btn ${tool==='structure'&&structKind===3?'active':''}`} onClick={()=>{structKindRef.current=3;setStructKind(3);setTool('structure');setDraft([])}} title="Toolbar: Embedded Beam Element"><CircleDot size={18} style={{color:tool==='structure'&&structKind===3?'#fff':'#9333ea'}}/></button>
       <div className="cad-tool-sep"/>
       <button className={`cad-tool-btn ${tool==='load'?'active':''}`} onClick={()=>{setTool('load');setDraft([])}} title="Toolbar: Surface Load"><ArrowDown size={18} style={{color:tool==='load'?'#fff':'#9333ea'}}/></button>
       <button className={`cad-tool-btn ${tool==='disp'?'active':''}`} onClick={()=>{setTool('disp');setDraft([])}} title="Toolbar: Prescribed Disp"><Crosshair size={18} style={{color:tool==='disp'?'#fff':'#0d9488'}}/></button>
      </>
     )}

     {mode==='Mesh'&&(
      <>
       <button className="cad-tool-btn" onClick={autoMesh} title="Toolbar: Auto Mesh Generator"><Grid2X2 size={18} style={{color:'#2563eb'}}/></button>
       <button className={`cad-tool-btn ${tool==='monitor'?'active':''}`} onClick={()=>{setTool('monitor');setDraft([])}} title="Toolbar: Monitor Sensor"><Crosshair size={18} style={{color:tool==='monitor'?'#fff':'#0d9488'}}/></button>
      </>
     )}

     {mode==='Flow Conditions'&&(
      <>
       <button className={`cad-tool-btn ${tool==='water'?'active':''}`} onClick={()=>{setTool('water');setDraft([])}} title="Phreatic Water Line"><Droplets size={18} style={{color:tool==='water'?'#fff':'#0891b2'}}/></button>
       <button className={`cad-tool-btn ${tool==='hydro'?'active':''}`} onClick={()=>{setTool('hydro');setDraft([])}} title="Toolbar: Water Drain/Well"><Droplets size={18} style={{color:tool==='hydro'?'#fff':'#0284c7'}}/></button>
      </>
     )}

     {mode==='Staged Construction'&&(
      <>
       <button className="cad-tool-btn" onClick={()=>setNotice('Click any soil polygon on canvas to toggle Active / Inactive')} title="Toolbar: Toggle Soil Polygon"><Layers size={18} style={{color:'#c25e00'}}/></button>
       <button className="cad-tool-btn btn-plate" onClick={()=>setNotice('Click any structure on canvas to toggle Active / Inactive')} title="Toolbar: Toggle Structure">I</button>
       <button className="cad-tool-btn" onClick={()=>setNotice('Click any load on canvas to toggle Active / Inactive')} title="Toolbar: Toggle Load"><ArrowDown size={18} style={{color:'#9333ea'}}/></button>
       <button className={`cad-tool-btn ${tool==='monitor'?'active':''}`} onClick={()=>{setTool('monitor');setDraft([])}} title="Monitor Point"><Crosshair size={18} style={{color:tool==='monitor'?'#fff':'#0d9488'}}/></button>
      </>
     )}

     <div className="cad-tool-sep"/>
     {/* Delete Tool */}
     <button className="cad-tool-btn btn-delete" onClick={removeSelected} title="Toolbar: Delete Object"><Trash2 size={18} style={{color:'#dc2626'}}/></button>
    </div>
   )}<div className="canvaswrap" ref={wrapRef} onDragOver={e=>{if(tab==='Output')return;e.preventDefault();e.dataTransfer.dropEffect='copy';const r=e.currentTarget.getBoundingClientRect();const pt=screenToWorld(e.clientX-r.left,e.clientY-r.top);let target=null;const polys=project.polygons||[];for(let i=polys.length-1;i>=0;i--){const p=polys[i];if(p.x&&pointInPoly(pt[0],pt[1],p.x,p.y)){target={key:'polygons',index:i};break}}if(!target){const structs=project.structs||[];for(let i=structs.length-1;i>=0;i--){const s=structs[i];if(pointNearSegment(pt,[s.x1,s.y1],[s.x2??s.x1,s.y2??s.y1],0.4)){target={key:'structs',index:i};break}}}setDropHighlight(target)}} onDragLeave={()=>setDropHighlight(null)} onDrop={e=>{if(tab==='Output')return;e.preventDefault();const r=e.currentTarget.getBoundingClientRect();const pt=screenToWorld(e.clientX-r.left,e.clientY-r.top);const matIdxStr=e.dataTransfer.getData('text/katai-material');if(matIdxStr!==''){const matIdx=Number(matIdxStr);const polys=project.polygons||[];for(let i=polys.length-1;i>=0;i--){const p=polys[i];if(p.x&&pointInPoly(pt[0],pt[1],p.x,p.y)){const nextPolys=[...polys];nextPolys[i]={...p,material:matIdx};setProjectSafe({...project,polygons:nextPolys});setSelected({key:'polygons',index:i});setNotice(`Assigned material "${project.materials?.[matIdx]?.name||matIdx}" to ${p.name||'Polygon '+(i+1)}`);break}}}const structMatStr=e.dataTransfer.getData('text/katai-struct-mat');if(structMatStr){try{const {key,index}=JSON.parse(structMatStr);const structs=project.structs||[];for(let i=structs.length-1;i>=0;i--){const s=structs[i];if(pointNearSegment(pt,[s.x1,s.y1],[s.x2??s.x1,s.y2??s.y1],0.4)){const nextStructs=[...structs];nextStructs[i]={...s,material:index};setProjectSafe({...project,structs:nextStructs});setSelected({key:'structs',index:i});setNotice(`Assigned material to ${s.name||'Structure '+(i+1)}`);break}}}catch{}}const stagePolyStr=e.dataTransfer.getData('text/katai-stage-poly');if(stagePolyStr!==''&&mode==='Staged Construction'&&active){const idx=Number(stagePolyStr);const arr=[...(active.poly||[])];while(arr.length<=idx)arr.push(1);arr[idx]=arr[idx]?0:1;setActive({...active,poly:arr});setNotice(`Toggled ${project.polygons?.[idx]?.name||'Polygon '+(idx+1)} (${arr[idx]?'Aktif':'Non-aktif'})`)}const stageStructStr=e.dataTransfer.getData('text/katai-stage-struct');if(stageStructStr!==''&&mode==='Staged Construction'&&active){const idx=Number(stageStructStr);const arr=[...(active.struct||[])];while(arr.length<=idx)arr.push(1);arr[idx]=arr[idx]?0:1;setActive({...active,struct:arr});setNotice(`Toggled ${project.structs?.[idx]?.name||'Structure '+(idx+1)} (${arr[idx]?'Aktif':'Non-aktif'})`)}const stageLoadStr=e.dataTransfer.getData('text/katai-stage-load');if(stageLoadStr!==''&&mode==='Staged Construction'&&active){const idx=Number(stageLoadStr);const arr=[...(active.load||[])];while(arr.length<=idx)arr.push(1);arr[idx]=arr[idx]?0:1;setActive({...active,load:arr});setNotice(`Toggled ${project.loads?.[idx]?.name||'Load '+(idx+1)} (${arr[idx]?'Aktif':'Non-aktif'})`)}setDropHighlight(null)}}><canvas ref={canvasRef} onPointerDown={canvasDown} onPointerMove={canvasMove} onPointerUp={canvasUp} onPointerLeave={canvasLeave} onDoubleClick={tab==='Output'?undefined:finishDraft} onWheel={e=>{e.preventDefault();zoom(e.deltaY<0?1.15:.87)}} onAuxClick={e=>e.preventDefault()} onContextMenu={e=>{if(e.button===1)e.preventDefault()}} style={{cursor:view.current.drag?'grabbing':tool==='select'?'default':tool==='pan'?'grab':'crosshair'}}/>{cursorPos && (
     <div className="canvas-coords-badge" data-testid="canvas-coords">
      <Crosshair size={12} style={{ color: '#2563eb' }} />
      <span>X: <strong>{cursorPos[0].toFixed(3)} m</strong></span>
      <span className="coord-sep">|</span>
      <span>Y: <strong>{cursorPos[1].toFixed(3)} m</strong></span>
     </div>
    )}{tab==='Output'&&activeResult&&resultRange&&outputView!=='structures'&&<div className="result-legend" data-testid="result-legend" aria-label={`${resultField} legend`}><b>{resultField}</b><div className="legend-scale"><div className="legend-ramp"/><div className="legend-labels"><span>{resultRange.max.toPrecision(3)}</span><span>{resultRange.min.toPrecision(3)}</span></div></div><small>{resultField.toLowerCase().includes('displacement')?'m':'kPa'}</small></div>}{tab==='Output'&&outputView==='structures'&&structSummary&&(<div className="struct-diagram-summary" data-testid="struct-summary-card"><div className="struct-summary-title">{structSummary.title} (scaled up {structDiagScale.toFixed(4)} times)</div><div className="struct-summary-val">Maximum value = <strong className="pos">{structSummary.maxVal.toFixed(1)} {structSummary.unit}</strong> ({structSummary.maxLoc})</div><div className="struct-summary-val">Minimum value = <strong className="neg">{structSummary.minVal.toFixed(1)} {structSummary.unit}</strong> ({structSummary.minLoc})</div></div>)}<div className="canvas-hint">{tab==='Output'?(outputView==='structures'?'Structure forces diagram · Stations':showDeformed?`Deformed mesh (${deformScale}x) · Result values`:'Undeformed mesh · Result values'):draft.length?`${draft.length} points · double click to finish`:`${mode} mode · ${tool} tool · ${snap?'Snap on':'Snap off'}`}</div>{tab==='Output'&&!activeResult&&<div className="empty-canvas" data-testid="output-empty"><ChartNoAxesCombined size={36} style={{color:'#94a3b8'}}/><b>No calculation results available</b><span>Run Calculate from the toolbar or select a phase with completed results.</span></div>}{tab==='Model'&&!mesh&&!project.polygons?.length&&<div className="empty-canvas"><Layers size={30}/><b>Draw your soil geometry</b><span>Select Soil polygon, then click points on the canvas.</span><span>Double click to finish the boundary.</span></div>}</div></div>{draft.length>0&&<div className="draftbar"><span>{draft.length} vertices</span><button className="outline" onClick={()=>setDraft([])}>Cancel</button><button className="primary" onClick={finishDraft}>Finish drawing</button></div>}<div className="statusbar"><span><span className="live-dot"/> {notice}</span><span>{bounds.xmin.toFixed(1)} – {bounds.xmax.toFixed(1)} m · {bounds.ymin.toFixed(1)} – {bounds.ymax.toFixed(1)} m</span><span>{job?.status||'Idle'}</span></div></main>
   <aside className="properties"><div className="pane-title"><span>{tab==='Output'?'CALCULATION RESULTS':'PROPERTIES'}</span><Settings2 size={14}/></div>{tab==='Output'&&activeResult?<><LiveMonitorChart job={job} phaseIndex={phase} project={project}/><div className="result-summary"><b>{activeResult.name}</b><span className={activeResult.ok?'good':'bad'}>{activeResult.ok?'Converged':'Not converged'}</span><div><small>Maximum displacement</small><strong>{Number(activeResult.max_disp).toPrecision(4)} m</strong></div>{footingReaction!==null&&<div data-testid="footing-reaction" data-kn={footingReaction}><small>Total footing reaction</small><strong>{footingReaction.toFixed(1)} kN</strong></div>}<div><small>Factor of safety</small><strong>{activeResult.fos>=0?`${activeResult.fos_lower_bound?'> ':''}${Number(activeResult.fos).toFixed(3)}`:'—'}</strong></div><div><small>Iterations</small><strong>{activeResult.iterations}</strong></div></div><details><summary>Nodal result table: all nodes</summary><div className="nodetable"><table><thead><tr><th>Node</th><th>x</th><th>y</th><th>ux</th><th>uy</th><th>σxx</th><th>σyy</th><th>p</th></tr></thead><tbody>{activeResult.mesh.x.map((x:number,i:number)=><tr key={i}><td>{i+1}</td><td>{x.toFixed(3)}</td><td>{activeResult.mesh.y[i].toFixed(3)}</td><td>{Number(activeResult.displacement?.[i*2]||0).toExponential(2)}</td><td>{Number(activeResult.displacement?.[i*2+1]||0).toExponential(2)}</td><td>{Number(activeResult.stress?.[i]?.[0]||0).toFixed(2)}</td><td>{Number(activeResult.stress?.[i]?.[1]||0).toFixed(2)}</td><td>{Number(activeResult.pore?.[i]||0).toFixed(2)}</td></tr>)}</tbody></table></div></details><details open><summary>Structure forces</summary>{(activeResult.struct_forces||[]).length>0?(activeResult.struct_forces||[]).map((x:Dict,i:number)=><div key={i}><div className="table-row"><b>{x.name}</b><span>N {Number(x.max_N).toPrecision(3)}</span><span>M {Number(x.max_M).toPrecision(3)}</span></div>{forceDiagram(x.stations,'M')}</div>):activeResult.fos>=0?<p className="muted">No structural forces reported for Safety phase (failure mechanism only).</p>:<p className="muted">No active structures in this phase.</p>}</details><details><summary>Interface forces</summary>{(activeResult.interface_forces||[]).map((x:Dict,i:number)=><div className="table-row" key={i}><b>{x.name}</b><span>τ {Number(x.max_abs_tau).toPrecision(3)}</span><span>Slip {Number(x.max_abs_slip).toPrecision(3)}</span></div>)}</details><details open><summary>Engine diagnostics</summary>{(activeResult.diagnostics||[]).length?(activeResult.diagnostics||[]).map((x:Dict,i:number)=><div className="diagnostic" key={i}><b>{x.code} · {x.severity}</b><span>{x.subject}: {x.message}</span></div>):<p className="muted">No engine diagnostics for this phase.</p>}</details></>:tab==='Output'?<LiveMonitorChart job={job} phaseIndex={phase} project={project}/>:selected?.key==='mesh'||(mode==='Mesh'&&(!selected||selected.key==='mesh'||selected.key==='project'))?<><div className="selected-title"><span className="eyebrow">MESH</span><div><b>Mesh settings</b></div></div><div className="fieldscroll"><MeshSettingsEditor project={project} mesh={mesh} onUpdate={mConf=>setProjectSafe({...project,mesh:mConf})} onGenerate={()=>autoMesh()}/></div><div className="property-footer"><span>PLAXIS Auto-Mesher Engine</span><button onClick={reloadSaved}><Undo2 size={13}/> Reload saved</button></div></>:active?<><div className="selected-title"><span className="eyebrow">{selected?.key==='project'?'PROJECT':selected?.key==='initial'?'INITIAL PHASE':selected?.key==='phases'?'CALCULATION PHASE':fmt(selected?.key||'Object').toUpperCase()}</span><div><b>{selected?.key==='initial'?(active.name||'Initial phase'):selected?.key==='phases'?`${(selected.index??0)+1}. ${active.name||`Phase ${(selected.index??0)+1}`}`:(active.name||labels[selected?.key||'']||'Project settings')}</b>{selected?.key!=='project'&&selected?.key!=='initial'&&<button onClick={removeSelected} title="Remove object"><X size={15}/></button>}</div></div><div className="fieldscroll">{selected?.key==='materials'&&active?<SoilMaterialEditor mat={active} onChange={setActive}/>:(selected?.key==='initial'||selected?.key==='phases')&&active?<StagePhaseEditor isInitial={selected.key==='initial'} phase={active} project={project} initialProc={project.initial_procedure} onInitialProcChange={proc=>{setProjectSafe({...project,initial_procedure:proc,initial:{...project.initial,...active}})}} onChange={setActive}/>:renderFields(active,objectFields)}{selected?.key==='polygons'&&active&&<PolygonEdgeEditor poly={active} onChange={setActive}/>}</div><div className="property-footer"><span>All .k2d schema fields</span><button onClick={reloadSaved}> <Undo2 size={13}/> Reload saved</button></div></>:<div className="inspector-empty"><Search size={20}/><span>Select a model object or choose Project properties to edit its data.</span></div>}</aside>
  </div>
  <div className="bottom"><div className="bottomhead"><span>MESSAGES</span><div><button disabled={!job} onClick={()=>job&&request(`/api/jobs/${job.id}`).then((x:Dict)=>{setJob(x);setLog(x.log_text)})}>Solver log</button>{job&&['queued','running'].includes(job.status)&&<button onClick={cancel}>Cancel job</button>}</div></div><div className="messages">{validation&&<pre className={validation.ok?'ok':'warn'}>{validation.stdout}{validation.stderr}</pre>}{job&&<pre>{job.status} · {job.message}{log?`\n${log}`:''}</pre>}{!validation&&!job&&<span>{notice}</span>}</div></div>
  {validation?.ok===false&&<div className="toast warn-toast"><b>Input contract</b><pre>{validation.stdout}</pre><button onClick={()=>setValidation(null)}><X/></button></div>}
  {isMeshing && (
   <div className="meshing-overlay" data-testid="meshing-loader" aria-live="assertive">
    <div className="meshing-modal">
     <div className="meshing-spinner" />
     <div className="meshing-text">
      <h3>Generating Finite Element Mesh</h3>
      <p>PLAXIS-style auto-mesher is creating nodes and elements. Please wait...</p>
     </div>
    </div>
   </div>
  )}
  {helpOpen&&<div className="modalveil" onClick={()=>setHelpOpen(false)}><div className="helpmodal" onClick={e=>e.stopPropagation()}><button className="modalclose" onClick={()=>setHelpOpen(false)}><X size={17}/></button><div className="brandmark small">K</div><h2>KATAI 2D Workbench</h2><p>PLAXIS-inspired project input and calculation result viewer backed by the KATAI finite-element engine.</p><dl><dt>Input</dt><dd>Build soil regions, structures, mesh settings, groundwater conditions and staged phases.</dd><dt>Canvas</dt><dd>Choose a drawing tool, click coordinates, and double click or select Finish drawing to complete a line or polygon.</dd><dt>Calculate</dt><dd>Validate, mesh and solve through the KATAI CLI. Result files stay with the saved project and are hash checked before loading.</dd><dt>Units</dt><dd>kN, m, day. Refer to the KATAI project schema for field names and enum values.</dd></dl><button className="primary" onClick={()=>setHelpOpen(false)}>Close</button></div></div>}
  {presetModalOpen&&<div className="modalveil" onClick={()=>setPresetModalOpen(false)}><div className="presetmodal" onClick={e=>e.stopPropagation()}><div className="presetmodal-header"><div><h2>Preset Library & Geotechnical Studies</h2><p>Choose a verified benchmark case or research study to load into the workbench.</p></div><button className="modalclose" aria-label="Close" onClick={()=>setPresetModalOpen(false)}><X size={17}/></button></div><div className="presetmodal-search"><input autoFocus type="text" placeholder="Search by case name, material or keyword..." value={presetSearch} onChange={e=>setPresetSearch(e.target.value)}/><div className="preset-tabs">{['All','Geotechnical Studies','Structural & Tunnel Cases','Corpus Benchmarks'].map(cat=><button key={cat} className={presetCategory===cat?'active':''} onClick={()=>setPresetCategory(cat)}>{cat}</button>)}</div></div><div className="preset-grid">{filteredPresets.map(preset=><div key={preset.filename} className="preset-card"><div className="preset-card-head"><span className="badge">{preset.category}</span>{preset.project.axisymmetric&&<span className="badge badge-axisym">Axisymmetric</span>}</div><h3>{preset.project.name}</h3><div className="preset-card-meta"><span>{preset.project.materials?.[0]?.name||'Soil'}</span><span>•</span><span>{preset.project.polygons?.length||0} region(s)</span><span>•</span><span>{preset.project.initial_procedure===2?'Safety (FoS)':preset.project.axisymmetric?'Axisymmetric (r-z)':'Static / Staged'}</span></div><button className="primary" onClick={()=>{setPresetModalOpen(false);loadExample(preset.project)}}>Load Preset</button></div>)}</div></div></div>}
 </div>
}
export default App
