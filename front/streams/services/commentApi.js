// One comment API shape for the two things that have comment sections —
// posts and tracks — so the comment sheet doesn't care which it's showing.
// The server gives both the same fields (threads, reactions, reply_to).
import {
  apiRequest, commentOnPost, fetchSocialPostComments, fetchCommentReplies,
  fetchPostComment, reactToComment,
} from './api';

const unwrap = (res) => res?.results ?? res;

export const commentApi = (kind, targetId) => {
  if (kind === 'track') {
    const base = `/tracks/${targetId}/comments/`;
    return {
      cacheKey: `comments:track:${targetId}`,
      list: () => apiRequest('get', base).then(unwrap),
      replies: (commentId, page = 1) => apiRequest('get', `${base}${commentId}/replies/`, null, { params: { page } }),
      create: (content, parent = null) => apiRequest('post', base, { content, ...(parent ? { parent } : {}) }),
      react: (commentId, emoji) => apiRequest('post', `${base}${commentId}/react/`, emoji ? { emoji } : {}),
      get: (commentId) => apiRequest('get', `${base}${commentId}/`),
    };
  }
  return {
    cacheKey: `comments:post:${targetId}`,
    list: () => fetchSocialPostComments(targetId),
    replies: (commentId, page = 1) => fetchCommentReplies(targetId, commentId, page),
    create: (content, parent = null) => commentOnPost(targetId, content, parent),
    react: (commentId, emoji) => reactToComment(commentId, emoji),
    get: (commentId) => fetchPostComment(commentId),
  };
};
