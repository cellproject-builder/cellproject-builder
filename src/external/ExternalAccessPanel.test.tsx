import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ExternalAccessPanel} from './ExternalAccessPanel';
const remote=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('@/cloud/runtime',()=>({cloudJson:remote.call,mutationHeaders:{'X-Cellproject-Request':'1'},getCloudRuntime:()=>null}));
vi.mock('@/cloud/vault/privacy',()=>({getVaultSession:()=>null}));
vi.mock('@/workspace/store',()=>({useWorkspaceStore:(selector:(state:unknown)=>unknown)=>selector({projects:{p1:{id:'p1',name:'Project'}},activeProjectId:'p1'})}));
let root:Root,host:HTMLDivElement;
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);remote.call.mockReset();});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('shows configuration status without offering a credential that cannot work',async()=>{
  remote.call.mockResolvedValue({enabled:false,credentials:[]});await act(async()=>root.render(<ExternalAccessPanel/>));
  expect(host.textContent).toContain('API e MCP');expect(host.textContent).toContain('servidor');expect(host.querySelector('form')).toBeNull();
});
it('revokes an existing grant without retaining or requesting its secret',async()=>{
  remote.call.mockResolvedValueOnce({enabled:true,credentials:[{id:'id1',name:'External runtime',tokenPrefix:'cp_preview',projects:['p1'],permissions:['read'],expiresAt:'2027-01-01T00:00:00Z',createdAt:'2026-10-01T00:00:00Z',revokedAt:null}]}).mockResolvedValueOnce({revoked:true}).mockResolvedValueOnce({enabled:true,credentials:[]});
  await act(async()=>root.render(<ExternalAccessPanel/>));expect(host.textContent).toContain('External runtime');
  const revoke=host.querySelector<HTMLButtonElement>('button[aria-label="Revogar External runtime"]')!;expect(revoke).not.toBeNull();await act(async()=>Simulate.click(revoke));
  expect(remote.call).toHaveBeenCalledWith('/api/integrations/external/credentials/id1',expect.objectContaining({method:'DELETE'}));expect(host.textContent).not.toContain('External runtime');expect(host.querySelector('input[type="password"]')).toBeNull();
});
