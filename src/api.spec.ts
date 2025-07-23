import { listServices, listMatchers } from './translate';

describe('API exports', () => {
  it('should expose list of services', () => {
    expect(Array.isArray(listServices())).toBe(true);
    expect(listServices().length).toBeGreaterThan(0);
  });

  it('should expose list of matchers', () => {
    expect(Array.isArray(listMatchers())).toBe(true);
    expect(listMatchers().length).toBeGreaterThan(0);
  });
});
