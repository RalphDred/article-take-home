import { requestTitles, savedFrontCache, useFrontCache } from '../frontCache';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const flush = () => new Promise<void>(resolve => setImmediate(() => resolve()));

describe('savedFrontCache', () => {
  it('keeps valid fields and drops the rest', () => {
    expect(savedFrontCache({ frontHeight: 2400, titles: { '1': 'One' } })).toEqual({
      frontHeight: 2400,
      titles: { '1': 'One' },
    });
    expect(savedFrontCache({ frontHeight: -5, titles: { '1': 2 } })).toEqual({});
    expect(savedFrontCache({ frontHeight: 900_000 })).toEqual({});
    expect(savedFrontCache('nonsense')).toEqual({});
  });
});

describe('requestTitles', () => {
  beforeEach(() => useFrontCache.setState({ titles: {} }));

  it('asks the manifest once per article, and only for titles it does not have', async () => {
    useFrontCache.setState({ titles: { '1': 'Known' } });
    const fetchJson = jest.fn((url: string) => Promise.resolve({ title: `Title of ${url.split('/')[4]}` }));

    requestTitles(['1', '2'], fetchJson);
    requestTitles(['2'], fetchJson); // still in flight
    await flush();

    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0]?.[0]).toMatch(/\/bundle\/2\/manifest\.json$/);
    expect(useFrontCache.getState().titles).toEqual({ '1': 'Known', '2': 'Title of 2' });
  });

  it('asks again later when the first request failed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchJson = jest
      .fn<Promise<unknown>, [string]>()
      .mockRejectedValueOnce(new Error('unreachable'))
      .mockResolvedValueOnce({ title: 'Three' });

    requestTitles(['3'], fetchJson);
    await flush();
    expect(useFrontCache.getState().titles).toEqual({});

    requestTitles(['3'], fetchJson);
    await flush();
    expect(useFrontCache.getState().titles).toEqual({ '3': 'Three' });

    warn.mockRestore();
  });
});
