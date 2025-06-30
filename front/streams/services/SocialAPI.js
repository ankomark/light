// import { makeAuthenticatedRequest, BASE_URL } from './api';

// // Fetch social posts
// export const fetchSocialPosts = async () => {
//   return makeAuthenticatedRequest('get', `${BASE_URL}/social-posts/`);
// };

// // Create a new social post
// export const createSocialPost = async (formData) => {
//   return makeAuthenticatedRequest('post', `${BASE_URL}/social-posts/`, formData, {
//     headers: {
//       'Content-Type': 'multipart/form-data',
//     },
//   });
// };

// // Like a post
// export const likePost = async (postId) => {
//   return makeAuthenticatedRequest('post', `${BASE_URL}/social-posts/${postId}/like/`);
// };

// // Comment on a post
// export const commentOnPost = async (postId, content) => {
//   return makeAuthenticatedRequest('post', `${BASE_URL}/social-posts/${postId}/comment/`, { content });
// };

// // Save a post
// export const savePost = async (postId) => {
//   return makeAuthenticatedRequest('post', `${BASE_URL}/social-posts/${postId}/save/`);
// };

// // Share a post
// export const getShareableLink = async (postId) => {
//   return makeAuthenticatedRequest('get', `${BASE_URL}/social-posts/${postId}/share/`);
// };

// // Download post media
// export const downloadPostMedia = async (postId) => {
//   return makeAuthenticatedRequest('get', `${BASE_URL}/social-posts/${postId}/download/`, null, {
//     responseType: 'blob',
//   });
// };