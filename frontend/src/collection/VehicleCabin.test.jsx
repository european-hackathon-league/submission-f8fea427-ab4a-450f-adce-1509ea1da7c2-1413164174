import React from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import VehicleCabin from './VehicleCabin.jsx';
const {rotation}=vi.hoisted(()=>({rotation:vi.fn()}));
vi.mock('three',()=>({
 Scene:class {},
 PerspectiveCamera:class {rotation={set:rotation};updateProjectionMatrix(){}},
 WebGLRenderer:class {domElement=document.createElement('canvas');setPixelRatio(){}setSize(){}render(){}dispose(){}forceContextLoss(){}},
 CubeTextureLoader:class {load(){return {dispose(){}};}},
 TextureLoader:class {load(){return {dispose(){}};}},
 EquirectangularReflectionMapping:1,SRGBColorSpace:1,
}));
beforeEach(()=>{rotation.mockClear();vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('turns left and right in the named direction and restores the cabin on reset',()=>{
 render(<VehicleCabin asset="f70"/>);
 fireEvent.click(screen.getByRole('button',{name:'Look left'}));
 expect(rotation.mock.lastCall[1]).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole('button',{name:'Reset view'}));
 expect(rotation.mock.lastCall).toEqual([0,0,0]);
 fireEvent.click(screen.getByRole('button',{name:'Look right'}));
 expect(rotation.mock.lastCall[1]).toBeLessThan(0);
 fireEvent.click(screen.getByRole('button',{name:'Reset view'}));
 const panorama=screen.getByRole('img');
 fireEvent.keyDown(panorama,{key:'ArrowLeft'});
 expect(rotation.mock.lastCall[1]).toBeGreaterThan(0);
 fireEvent.keyDown(panorama,{key:'ArrowRight'});
 expect(rotation.mock.lastCall[1]).toBe(0);
});
