import {cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,describe,it,expect} from 'vitest';
import App from './App';

afterEach(()=>{cleanup();window.localStorage.clear();});

describe('prepared pitch workflows',()=>{
  it('shows four context-scoped indicators and labels feedback as component records',async()=>{
    render(<App/>);
    expect(screen.getByText('Feedback volume')).toBeInTheDocument();
    expect(screen.getByText('Negative-feedback share')).toBeInTheDocument();
    expect(screen.getByText('Largest comparable change')).toBeInTheDocument();
    expect(screen.getByText('Requirements awaiting decision')).toBeInTheDocument();
    expect(screen.getByText(/component feedback records · not unique customers/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Latest prepared analysis/i)).toHaveLength(2);
    const user=userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox',{name:'Market'}),'China');
    expect(screen.getByText(/no comparable baseline/i)).toBeInTheDocument();
  });

  it('switches Compare between separate period and market modes',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:'Compare'}));
    expect(screen.getByRole('tab',{name:'Period comparison'})).toHaveAttribute('aria-selected','true');
    expect(screen.getByRole('heading',{name:'Body & access'})).toBeInTheDocument();
    expect(screen.queryByRole('table',{name:'Market snapshot'})).not.toBeInTheDocument();
    screen.getByRole('tab',{name:'Period comparison'}).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab',{name:'Market comparison'})).toHaveAttribute('aria-selected','true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab',{name:'Period comparison'})).toHaveAttribute('aria-selected','true');
    await user.click(screen.getByRole('tab',{name:'Market comparison'}));
    expect(screen.getByRole('tab',{name:'Market comparison'})).toHaveAttribute('aria-selected','true');
    expect(screen.queryByRole('heading',{name:/Period comparison/i})).not.toBeInTheDocument();
    expect(screen.getByRole('heading',{name:/Market comparison/i})).toBeInTheDocument();
    expect(screen.getByRole('table',{name:'Market snapshot'})).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox',{name:'Comparison component'}),'steering');
    expect(screen.getByText(/Steering-wheel controls · 2026 snapshots/)).toBeInTheDocument();
    expect(within(screen.getByRole('row',{name:/Europe/})).getByText('25%')).toBeInTheDocument();
  });

  it('keeps unsupported research questions unresolved, and allows cancel and retry of prepared results',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(screen.getByRole('button',{name:'View evidence'}));
    await user.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Explore research'}));
    const dialog=screen.getByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox',{name:'Research question'}));
    await user.type(within(dialog).getByRole('textbox',{name:'Research question'}),'Does this improve crash safety?');
    await user.click(within(dialog).getByRole('button',{name:'Load prepared result'}));
    expect(within(dialog).getByText(/no prepared result covers this question/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button',{name:'Cancel prepared result'}));
    expect(within(dialog).getByText(/cancelled by you/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button',{name:'Retry prepared result'}));
    expect(within(dialog).getByText(/no prepared result covers this question/i)).toBeInTheDocument();
  });

  it('uses edited selected concept text to create a draft',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:/Requirements/}));
    await user.click(screen.getByRole('button',{name:'Reimagine'}));
    const dialog=screen.getByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox',{name:'Edit concept 2'}));
    await user.type(within(dialog).getByRole('textbox',{name:'Edit concept 2'}),'Keep the most-used climate controls visible.');
    await user.click(within(dialog).getByRole('radio',{name:'Choose concept 2'}));
    await user.click(within(dialog).getByRole('button',{name:'Create draft requirement'}));
    expect(screen.getByRole('heading',{name:'Keep the most-used climate controls visible.'})).toBeInTheDocument();
  });

  it('keeps the research scope and edited preferred concept when inspecting its linked evidence inline',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:/Requirements/}));
    await user.click(screen.getByRole('button',{name:'Reimagine'}));
    const dialog=screen.getByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox',{name:'Edit concept 2'}));
    await user.type(within(dialog).getByRole('textbox',{name:'Edit concept 2'}),'Keep common controls visible.');
    await user.click(within(dialog).getByRole('radio',{name:'Choose concept 2'}));
    const concept=dialog.querySelectorAll('.proposal')[1];
    await user.click(within(concept as HTMLElement).getByRole('button',{name:/View evidence/}));
    expect(screen.getByRole('dialog',{name:/Deep Research and Reimagine/})).toBeInTheDocument();
    expect(within(concept as HTMLElement).getByText(/Local source locator · body-E2/)).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox',{name:'Research scope'})).toHaveValue('Europe');
    expect(within(dialog).getByRole('radio',{name:'Choose concept 2'})).toBeChecked();
    expect(within(dialog).getByRole('textbox',{name:'Edit concept 2'})).toHaveValue('Keep common controls visible.');
    await user.click(within(dialog).getByRole('button',{name:'Create draft requirement'}));
    expect(screen.getByRole('heading',{name:'Keep common controls visible.'})).toBeInTheDocument();
  });

  it('sorts by current negative share and edits an approved requirement into a new draft version',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:/Requirements/}));
    await user.selectOptions(screen.getByRole('combobox',{name:'Sort requirements'}),'negative-high');
    const rows=screen.getAllByRole('article');
    expect(rows[0]).toHaveTextContent('Dashboard & display');
    const approved=rows.find(row=>row.textContent?.includes('REQ-004'))!;
    await user.click(within(approved).getByRole('button',{name:/review/i}));
    const dialog=screen.getByRole('dialog',{name:/review requirement/i});
    await user.clear(within(dialog).getByRole('textbox',{name:/Requirement text/}));
    await user.type(within(dialog).getByRole('textbox',{name:/Requirement text/}),'Make saved seat positions easier to find.');
    await user.type(within(dialog).getByRole('textbox',{name:/decision rationale/i}),'Needs renewed customer validation.');
    await user.click(within(dialog).getByRole('button',{name:'View linked evidence'}));
    expect(within(dialog).getByText(/seats-E2/)).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox',{name:/Requirement text/})).toHaveValue('Make saved seat positions easier to find.');
    await user.click(within(dialog).getByRole('button',{name:'Save edit'}));
    const revised=screen.getByRole('heading',{name:'Make saved seat positions easier to find.'}).closest('article')!;
    expect(revised).toHaveTextContent('Draft');
    expect(revised).toHaveTextContent('v2');
    await user.click(within(revised).getByRole('button',{name:/view version history/i}));
    expect(within(revised).getByText(/Version 1 · Approved/i)).toBeInTheDocument();
  });

  it('sorts unavailable priorities first and preserves an approved version when challenged',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.selectOptions(screen.getByRole('combobox',{name:'Market'}),'China');
    await user.selectOptions(screen.getByRole('combobox',{name:'Period'}),'2025');
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:/Requirements/}));
    await user.selectOptions(screen.getByRole('combobox',{name:'Sort requirements'}),'unscored');
    expect(screen.getAllByRole('article')[0].querySelector('.req-priority')).toHaveTextContent('—');
    await user.selectOptions(screen.getByRole('combobox',{name:'Market'}),'Europe');
    await user.selectOptions(screen.getByRole('combobox',{name:'Period'}),'2026');
    const approved=screen.getAllByRole('article').find(row=>row.textContent?.includes('REQ-004'))!;
    await user.click(within(approved).getByRole('button',{name:/review/i}));
    const dialog=screen.getByRole('dialog',{name:/review requirement/i});
    await user.type(within(dialog).getByRole('textbox',{name:/decision rationale/i}),'Challenge pending validation.');
    await user.click(within(dialog).getByRole('button',{name:'Challenge'}));
    const challenged=screen.getAllByRole('article').find(row=>row.textContent?.includes('REQ-004'))!;
    expect(challenged).toHaveTextContent('Deferred');
    expect(challenged).toHaveTextContent('v2');
    await user.click(within(challenged).getByRole('button',{name:/view version history/i}));
    expect(within(challenged).getByText(/Version 1 · Approved/)).toBeInTheDocument();
    expect(within(challenged).getByText(/Superseded when version 2 was challenged/)).toBeInTheDocument();
  });

  it('guides only the built-in fixture through review, analysis and changes',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:/data & history/i}));
    await user.click(screen.getByRole('button',{name:'Use built-in sample'}));
    expect(screen.getByRole('heading',{name:/Review prepared fixture/i})).toBeInTheDocument();
    expect(screen.getByText(/18 synthetic evidence records/i)).toBeInTheDocument();
    expect(screen.getByText(/duplicate or missing-field checks; those counts are unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/China and United States have 2026 snapshots only/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Analyze prepared fixture'}));
    expect(await screen.findByRole('heading',{name:/Prepared analysis changes/i})).toBeInTheDocument();
    expect(screen.getByText(/uploaded files were not parsed/i)).toBeInTheDocument();
  });

  it('keeps the selected exterior component when Exterior is selected again',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:'Vehicle Explorer'}));
    await user.click(await screen.findByRole('button',{name:/Headlamps/}));
    await user.click(screen.getByRole('button',{name:'Exterior 3D'}));
    expect(screen.getByRole('heading',{name:'Lighting & visibility'})).toBeInTheDocument();
  });
});
