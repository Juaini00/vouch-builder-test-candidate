import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok status with the service version', () => {
    const controller = new HealthController();

    const result = controller.check();

    expect(result).toEqual({ status: 'ok', version: '0.1.0' });
  });
});
