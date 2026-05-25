import { describe, it, expect } from 'vitest';
import { parseStepsXml, extractSharedStepIds } from '../src/core/ado-client.js';

describe('parseStepsXml', () => {
  it('parses simple action steps', () => {
    const xml = `<steps id="0" last="2">
      <step id="1" type="ActionStep">
        <parameterizedString isformatted="true">Open login page</parameterizedString>
        <parameterizedString isformatted="true">Form is visible</parameterizedString>
        <description/>
      </step>
      <step id="2" type="ActionStep">
        <parameterizedString isformatted="true">Enter &lt;b&gt;valid&lt;/b&gt; credentials</parameterizedString>
        <parameterizedString isformatted="true">User is logged in</parameterizedString>
        <description/>
      </step>
    </steps>`;
    const steps = parseStepsXml(xml);
    expect(steps).toHaveLength(2);
    expect(steps[0]?.action).toBe('Open login page');
    expect(steps[0]?.expected).toBe('Form is visible');
    expect(steps[1]?.action).toBe('Enter valid credentials');
    expect(steps[1]?.isSharedStep).toBe(false);
  });

  it('parses shared step references', () => {
    const xml = `<steps>
      <step id="1" type="ActionStep">
        <parameterizedString isformatted="true">First</parameterizedString>
        <parameterizedString isformatted="true">OK</parameterizedString>
        <description/>
      </step>
      <compref id="2" ref="9001"></compref>
    </steps>`;
    const steps = parseStepsXml(xml);
    expect(steps).toHaveLength(2);
    const shared = steps.find((s) => s.isSharedStep);
    expect(shared?.sharedStepId).toBe(9001);
  });

  it('handles empty input', () => {
    expect(parseStepsXml('')).toEqual([]);
    expect(parseStepsXml('   ')).toEqual([]);
  });

  it('extracts shared step ids from xml', () => {
    const xml = `<steps>
      <compref id="2" ref="1001"></compref>
      <compref id="3" ref="1002"></compref>
      <compref id="4" ref="1001"></compref>
    </steps>`;
    const ids = extractSharedStepIds(xml);
    expect(ids.sort()).toEqual([1001, 1002]);
  });
});
