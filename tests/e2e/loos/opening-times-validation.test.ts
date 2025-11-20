import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateLooId } from '../../../src/services/loo';
import { testClient } from '../context';
import {
  authedJsonHeaders,
  deleteTestLoos,
  issueAuthToken,
} from './helpers';

/** Comprehensive validation tests for opening times */
describe.sequential('Opening Times Validation', () => {
  let authToken: string;
  let createdIds: string[] = [];

  beforeAll(async () => {
    authToken = issueAuthToken();
  });

  afterAll(async () => {
    await deleteTestLoos(createdIds);
  });

  it('accepts valid opening times with all days open', async () => {
    const id = generateLooId();
    const payload = {
      id,
      name: 'All Days Open Loo',
      openingTimes: [
        ['09:00', '17:00'], // Monday
        ['09:00', '17:00'], // Tuesday
        ['09:00', '17:00'], // Wednesday
        ['09:00', '17:00'], // Thursday
        ['09:00', '17:00'], // Friday
        ['09:00', '17:00'], // Saturday
        ['09:00', '17:00'], // Sunday
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.openingTimes).toEqual(payload.openingTimes);
    createdIds.push(id);
  });

  it('accepts opening times with some days closed', async () => {
    const id = generateLooId();
    const payload = {
      id,
      name: 'Weekdays Only Loo',
      openingTimes: [
        ['09:00', '17:00'], // Monday
        ['09:00', '17:00'], // Tuesday
        ['09:00', '17:00'], // Wednesday
        ['09:00', '17:00'], // Thursday
        ['09:00', '17:00'], // Friday
        [],                 // Saturday (closed)
        [],                 // Sunday (closed)
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.openingTimes).toEqual(payload.openingTimes);
    createdIds.push(id);
  });

  it('accepts opening times with all days closed', async () => {
    const id = generateLooId();
    const payload = {
      id,
      name: 'All Days Closed Loo',
      openingTimes: [
        [], // Monday (closed)
        [], // Tuesday (closed)
        [], // Wednesday (closed)
        [], // Thursday (closed)
        [], // Friday (closed)
        [], // Saturday (closed)
        [], // Sunday (closed)
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.openingTimes).toEqual(payload.openingTimes);
    createdIds.push(id);
  });

  it('accepts null for completely unknown opening times', async () => {
    const id = generateLooId();
    const payload = {
      id,
      name: 'Unknown Hours Loo',
      openingTimes: null,
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.openingTimes).toBeNull();
    createdIds.push(id);
  });

  it('accepts varying opening times across days', async () => {
    const id = generateLooId();
    const payload = {
      id,
      name: 'Variable Hours Loo',
      openingTimes: [
        ['08:00', '16:00'], // Monday
        ['09:00', '17:00'], // Tuesday
        ['10:00', '18:00'], // Wednesday
        ['09:30', '17:30'], // Thursday
        ['08:00', '20:00'], // Friday
        ['10:00', '14:00'], // Saturday
        [],                 // Sunday (closed)
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.openingTimes).toEqual(payload.openingTimes);
    createdIds.push(id);
  });

  it('rejects opening times with invalid time format', async () => {
    const payload = {
      id: generateLooId(),
      name: 'Invalid Format Loo',
      openingTimes: [
        ['9:00', '17:00'], // Invalid: missing leading zero
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        [],
        [],
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.issues).toBeDefined();
  });

  it('rejects opening times with closing before opening', async () => {
    const payload = {
      id: generateLooId(),
      name: 'Backwards Hours Loo',
      openingTimes: [
        ['17:00', '09:00'], // Invalid: closing before opening
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        [],
        [],
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.issues).toBeDefined();
  });

  it('rejects opening times with invalid hour (25:00)', async () => {
    const payload = {
      id: generateLooId(),
      name: 'Invalid Hour Loo',
      openingTimes: [
        ['09:00', '25:00'], // Invalid: hour > 23
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        [],
        [],
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.issues).toBeDefined();
  });

  it('rejects opening times with invalid minute (09:60)', async () => {
    const payload = {
      id: generateLooId(),
      name: 'Invalid Minute Loo',
      openingTimes: [
        ['09:00', '17:60'], // Invalid: minute > 59
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        [],
        [],
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.issues).toBeDefined();
  });

  it('rejects opening times with wrong array length (6 days)', async () => {
    const payload = {
      id: generateLooId(),
      name: 'Wrong Length Loo',
      openingTimes: [
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        [], // Only 6 days instead of 7
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.issues).toBeDefined();
  });

  it('rejects opening times with incomplete day entry (only one time)', async () => {
    const payload = {
      id: generateLooId(),
      name: 'Incomplete Day Loo',
      openingTimes: [
        ['09:00'], // Invalid: missing close time
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        [],
        [],
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.issues).toBeDefined();
  });

  it('accepts edge case: opening at midnight and closing at 23:59', async () => {
    const id = generateLooId();
    const payload = {
      id,
      name: '24 Hour Loo',
      openingTimes: [
        ['00:00', '23:59'], // Monday
        ['00:00', '23:59'], // Tuesday
        ['00:00', '23:59'], // Wednesday
        ['00:00', '23:59'], // Thursday
        ['00:00', '23:59'], // Friday
        ['00:00', '23:59'], // Saturday
        ['00:00', '23:59'], // Sunday
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.openingTimes).toEqual(payload.openingTimes);
    createdIds.push(id);
  });

  it('accepts opening times equal to each other (same time)', async () => {
    const payload = {
      id: generateLooId(),
      name: 'Same Time Loo',
      openingTimes: [
        ['09:00', '09:00'], // Invalid: opening == closing
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        ['09:00', '17:00'],
        [],
        [],
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    // This should be rejected because opening must be BEFORE closing
    expect(response.status).toBe(400);
  });

  it('accepts ["00:00", "00:00"] as 24-hour representation', async () => {
    const id = generateLooId();
    const payload = {
      id,
      name: 'True 24 Hour Loo',
      openingTimes: [
        ['00:00', '00:00'], // Monday - 24 hours
        ['00:00', '00:00'], // Tuesday - 24 hours
        ['00:00', '00:00'], // Wednesday - 24 hours
        ['00:00', '00:00'], // Thursday - 24 hours
        ['00:00', '00:00'], // Friday - 24 hours
        ['00:00', '00:00'], // Saturday - 24 hours
        ['00:00', '00:00'], // Sunday - 24 hours
      ],
    };

    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.openingTimes).toEqual(payload.openingTimes);
    createdIds.push(id);
  });
});

