/**
 * OpenRouter API 服务
 * 提供与 AI 模型交互的基本功能
 */

// 配置信息
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
// API 密钥应该从环境变量或配置文件中获取
const API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY || '';
const SITE_URL = import.meta.env.VITE_SITE_URL || 'https://conceptmap.app';
const SITE_NAME = '光场思维地图';

// 修复非 ASCII 字符问题
const encodedSiteName = encodeURIComponent(SITE_NAME);

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatCompletionResponse {
  id: string;
  choices: {
    message: Message;
    finish_reason: string;
    index: number;
  }[];
  model: string;
  created: number;
}

/**
 * 发送聊天请求到 OpenRouter API
 */
export async function sendChatRequest(
  messages: Message[], 
  model: string = 'openai/gpt-4o',
  temperature: number = 0.7
): Promise<string> {
  try {
    if (!API_KEY) {
      throw new Error('未配置 OpenRouter API 密钥');
    }

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'HTTP-Referer': SITE_URL,
        'X-Title': encodedSiteName,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API 请求失败: ${errorData.error?.message || response.statusText}`);
    }

    const data: ChatCompletionResponse = await response.json();
    return data.choices[0]?.message.content || '';
  } catch (error) {
    console.error('OpenRouter API 请求错误:', error);
    throw error;
  }
}

/**
 * 基于概念节点内容生成相关建议
 */
export async function generateSuggestions(nodeContent: string): Promise<string[]> {
  const prompt = `
  我正在构建一个概念地图，其中有以下内容的节点:
  "${nodeContent}"
  
  请提供5个相关概念或想法，这些概念可以与此节点相连接。简洁回答，每行一个概念，不需要额外解释。
  `;

  try {
    const response = await sendChatRequest([
      { role: 'system', content: '你是一个帮助用户构建知识地图的助手，擅长关联概念和提供洞见。请保持回答简洁、有启发性。' },
      { role: 'user', content: prompt }
    ]);
    
    // 分割回答为单独的建议
    return response
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .slice(0, 5);
  } catch (error) {
    console.error('生成建议错误:', error);
    return ['无法生成建议，请稍后再试'];
  }
}

/**
 * 发送流式聊天请求到 OpenRouter API
 * @param messages 消息数组
 * @param onChunk 接收每个文本块的回调函数
 * @param model 模型名称
 * @param temperature 温度参数
 * @returns 完整的响应文本
 */
export async function sendStreamingChatRequest(
  messages: Message[],
  onChunk: (chunk: string) => void,
  model: string = 'google/gemini-2.0-flash-lite-001',
  temperature: number = 0.7
): Promise<string> {
  try {
    if (!API_KEY) {
      throw new Error('未配置 OpenRouter API 密钥');
    }

    // 确保所有头信息值仅包含ISO-8859-1字符
    const headers = {
      'Authorization': `Bearer ${API_KEY}`,
      'HTTP-Referer': SITE_URL,
      // 完全移除可能引起问题的头信息
      // 'X-Title': encodedSiteName,
      'Content-Type': 'application/json',
    };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream: true,
      }),
    });

    if (!response.ok) {
      // 优化错误处理
      try {
        const errorData = await response.json();
        throw new Error(`API 请求失败: ${errorData.error?.message || response.statusText}`);
      } catch (e) {
        throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
      }
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('响应体不可读');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    try {
      // 使用更高效的处理方式
      const processLines = () => {
        let lineEnd;
        while ((lineEnd = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);
          
          if (!line || !line.startsWith('data: ')) continue;
          
          const data = line.slice(6);
          if (data === '[DONE]') return;
          
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              onChunk(content);
              fullText += content;
            }
          } catch (e) {
            // 忽略无效的 JSON，但记录日志以便调试
            console.debug('无法解析流式响应行:', line);
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        processLines();
      }
      
      // 处理缓冲区中可能剩余的数据
      if (buffer.trim()) {
        buffer += '\n';
        processLines();
      }
    } finally {
      reader.cancel();
    }

    return fullText;
  } catch (error) {
    console.error('OpenRouter 流式 API 请求错误:', error);
    // 向上层传递错误，以便UI可以适当处理
    throw error;
  }
} 