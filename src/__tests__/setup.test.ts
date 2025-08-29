describe('Setup Test', () => {
  it('should verify Jest is configured correctly', () => {
    expect(true).toBe(true);
  });

  it('should verify TypeScript compilation works', () => {
    const sum = (a: number, b: number): number => a + b;
    expect(sum(1, 2)).toBe(3);
  });
});