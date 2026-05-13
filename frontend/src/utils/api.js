/**
 * API utility using native Fetch API
 * Replaces axios to reduce bundle size by 15+ KB
 */

/**
 * GET request
 * @param {string} endpoint - API endpoint
 * @param {object} config - Configuration object
 * @param {AbortSignal} config.signal - AbortController signal for request cancellation
 * @param {object} config.params - Query parameters
 * @returns {Promise} Response with data property
 */
export const get = async (endpoint, config = {}) => {
  // Build URL with query parameters
  let url = endpoint;

  if (config.params) {
    const queryParams = new URLSearchParams();
    Object.keys(config.params).forEach((key) => {
      queryParams.append(key, config.params[key]);
    });
    const queryString = queryParams.toString();
    if (queryString) {
      url = `${endpoint}?${queryString}`;
    }
  }

  const response = await fetch(url, {
    method: 'GET',
    signal: config.signal,
    headers: {
      'Content-Type': 'application/json',
      ...config.headers
    }
  });

  // Handle errors
  if (!response.ok) {
    const error = new Error('API Error');
    error.name = response.status === 0 ? 'AbortError' : 'Error';
    error.status = response.status;

    try {
      const errorText = await response.text();
      error.message = errorText || `HTTP ${response.status}`;
    } catch (e) {
      error.message = `HTTP ${response.status}`;
    }

    throw error;
  }

  let data;
  try {
    const text = await response.text();
    if (!text) {
      console.error('Empty response body');
      throw new Error('Empty response from server');
    }
    data = JSON.parse(text);
  } catch (parseError) {
    console.error('Failed to parse JSON response:', parseError, response);
    throw new Error('Invalid JSON response from server: ' + parseError.message);
  }

  if (!data) {
    console.error('Parsed data is null or undefined');
    throw new Error('Empty response from server');
  }

  return { data };
};

/**
 * Abort pending request
 * Helper to check if signal is aborted
 */
export const isAborted = (signal) => {
  return signal?.aborted || false;
};
