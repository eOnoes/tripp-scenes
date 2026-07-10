const PROVIDERS = {
  fal: {
    label: 'Fal', env: 'FAL_KEY', image: true, video: true, async: true,
    imageModels: ['fal-ai/flux-pro/v1.1-ultra', 'fal-ai/flux/dev'],
    videoModels: ['fal-ai/kling-video/v2.1/master/text-to-video', 'fal-ai/wan/v2.2-a14b/text-to-video']
  },
  venice: {
    label: 'Venice', env: 'VENICE_API_KEY', image: true, video: true, async: true,
    imageModels: ['qwen-image-2', 'venice-sd35'],
    videoModels: ['wan-2.5-preview-text-to-video']
  },
  openai: {
    label: 'OpenAI', env: 'OPENAI_API_KEY', image: true, video: false, async: false,
    imageModels: ['gpt-image-2', 'gpt-image-1.5'], videoModels: []
  }
};

function capabilities() {
  return Object.entries(PROVIDERS).map(([id, value]) => ({
    id, ...value, configured: Boolean(process.env[value.env])
  }));
}

async function generateImage(request) {
  if (request.provider === 'venice') return veniceImage(request);
  if (request.provider === 'openai') return openaiImage(request);
  if (request.provider === 'fal') return falImage(request);
  throw new Error(`Unsupported image provider: ${request.provider}`);
}

async function generateVideo(request) {
  if (request.provider === 'venice') return veniceVideo(request);
  if (request.provider === 'fal') return falVideo(request);
  throw new Error(`Unsupported video provider: ${request.provider}`);
}

async function veniceImage({ model, prompt, negativePrompt, aspectRatio, resolution }) {
  const key = requiredKey('VENICE_API_KEY');
  const response = await fetch('https://api.venice.ai/api/v1/image/generate', {
    method: 'POST', headers: authHeaders(key), body: JSON.stringify({
      model: model || 'qwen-image-2', prompt, negative_prompt: negativePrompt || undefined,
      aspect_ratio: aspectRatio || '9:16', resolution: resolution || '1K', format: 'webp', safe_mode: true
    })
  });
  const data = await readJson(response);
  return { bytes: Buffer.from(data.images[0], 'base64'), contentType: 'image/webp', providerRequestId: data.id };
}

async function openaiImage({ model, prompt, aspectRatio, quality }) {
  const key = requiredKey('OPENAI_API_KEY');
  const size = aspectRatio === '16:9' ? '1536x1024' : aspectRatio === '9:16' ? '1024x1536' : '1024x1024';
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: authHeaders(key), body: JSON.stringify({
      model: model || 'gpt-image-2', prompt, size, quality: quality || 'medium', output_format: 'png'
    })
  });
  const data = await readJson(response);
  return { bytes: Buffer.from(data.data[0].b64_json, 'base64'), contentType: 'image/png' };
}

async function falImage({ model, prompt, negativePrompt, aspectRatio }) {
  const key = requiredKey('FAL_KEY');
  const endpoint = model || 'fal-ai/flux-pro/v1.1-ultra';
  const response = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST', headers: { ...authHeaders(key), Authorization: `Key ${key}` }, body: JSON.stringify({
      prompt, negative_prompt: negativePrompt || undefined, aspect_ratio: aspectRatio || 'portrait_16_9', num_images: 1
    })
  });
  const queued = await readJson(response);
  const result = await pollFal(endpoint, queued.request_id, key);
  const imageResponse = await fetch(result.images[0].url);
  return { bytes: Buffer.from(await imageResponse.arrayBuffer()), contentType: imageResponse.headers.get('content-type') || 'image/webp', providerRequestId: queued.request_id };
}

async function veniceVideo({ model, prompt, negativePrompt, aspectRatio, duration, resolution }) {
  const key = requiredKey('VENICE_API_KEY');
  const selectedModel = model || 'wan-2.5-preview-text-to-video';
  const queued = await readJson(await fetch('https://api.venice.ai/api/v1/video/queue', {
    method: 'POST', headers: authHeaders(key), body: JSON.stringify({
      model: selectedModel, prompt, negative_prompt: negativePrompt || undefined,
      duration: duration || '5s', resolution: resolution || '720p', aspect_ratio: aspectRatio || '9:16'
    })
  }));
  for (let attempt = 0; attempt < 120; attempt++) {
    const response = await fetch('https://api.venice.ai/api/v1/video/retrieve', {
      method: 'POST', headers: authHeaders(key), body: JSON.stringify({ model: selectedModel, queue_id: queued.queue_id })
    });
    const type = response.headers.get('content-type') || '';
    if (type.includes('video/mp4')) return { bytes: Buffer.from(await response.arrayBuffer()), contentType: 'video/mp4', providerRequestId: queued.queue_id };
    const status = await readJson(response);
    if (status.status === 'COMPLETED' && queued.download_url) {
      const media = await fetch(queued.download_url);
      return { bytes: Buffer.from(await media.arrayBuffer()), contentType: 'video/mp4', providerRequestId: queued.queue_id };
    }
    if (status.status === 'FAILED') throw new Error(status.error || 'Venice video generation failed');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error('Venice video generation timed out');
}

async function falVideo({ model, prompt, negativePrompt, aspectRatio, duration }) {
  const key = requiredKey('FAL_KEY');
  const endpoint = model || 'fal-ai/wan/v2.2-a14b/text-to-video';
  const response = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST', headers: { ...authHeaders(key), Authorization: `Key ${key}` }, body: JSON.stringify({
      prompt, negative_prompt: negativePrompt || undefined, aspect_ratio: aspectRatio || '9:16', duration: duration || '5'
    })
  });
  const queued = await readJson(response);
  const result = await pollFal(endpoint, queued.request_id, key);
  const mediaUrl = result.video?.url || result.output?.url || result.url;
  if (!mediaUrl) throw new Error('Fal returned no video URL');
  const media = await fetch(mediaUrl);
  return { bytes: Buffer.from(await media.arrayBuffer()), contentType: media.headers.get('content-type') || 'video/mp4', providerRequestId: queued.request_id };
}

async function pollFal(endpoint, requestId, key) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const statusResponse = await fetch(`https://queue.fal.run/${endpoint}/requests/${requestId}/status`, { headers: { Authorization: `Key ${key}` } });
    const status = await readJson(statusResponse);
    if (status.status === 'COMPLETED') {
      return readJson(await fetch(`https://queue.fal.run/${endpoint}/requests/${requestId}`, { headers: { Authorization: `Key ${key}` } }));
    }
    if (status.status === 'FAILED') throw new Error(status.error || 'Fal generation failed');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Fal generation timed out');
}

function requiredKey(name) {
  if (!process.env[name]) throw new Error(`${name} is not configured. Add it to your environment before generating.`);
  return process.env[name];
}

function authHeaders(key) {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function readJson(response) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data.error?.message || data.error || `Provider request failed (${response.status})`);
  return data;
}

module.exports = { capabilities, generateImage, generateVideo };
