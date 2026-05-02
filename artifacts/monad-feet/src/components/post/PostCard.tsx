import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Post } from "@workspace/api-client-react/src/generated/api.schemas";
import { useLikePost, useUnlikePost, getListPostsQueryKey, getGetPostQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Heart } from "lucide-react";

export function PostCard({ post }: { post: Post }) {
  const queryClient = useQueryClient();
  const likePost = useLikePost();
  const unlikePost = useUnlikePost();

  const handleLikeToggle = async () => {
    try {
      if (post.likedByMe) {
        await unlikePost.mutateAsync({ data: { postId: post.id } });
      } else {
        await likePost.mutateAsync({ data: { postId: post.id } });
      }
      queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPostQueryKey(post.id) });
    } catch (e) {
      console.error(e);
    }
  };

  const initials = post.authorName ? post.authorName.slice(0, 2).toUpperCase() : "??";

  return (
    <Card className="hover-elevate overflow-hidden transition-all duration-200">
      <CardHeader className="p-4 pb-2 flex flex-row items-center gap-3">
        <Link href={`/profile/${post.authorId}`}>
          <Avatar className="h-10 w-10 cursor-pointer">
            <AvatarImage src={post.authorAvatarUrl || ""} alt={post.authorName || "User"} />
            <AvatarFallback className="bg-primary/10 text-primary font-medium">{initials}</AvatarFallback>
          </Avatar>
        </Link>
        <div className="flex flex-col">
          <Link href={`/profile/${post.authorId}`} className="font-semibold text-sm hover:underline">
            {post.authorName}
          </Link>
          <div className="flex items-center text-xs text-muted-foreground gap-1">
            <span>@{post.authorUsername}</span>
            <span>·</span>
            <span>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed">
          {post.content}
        </p>
        {post.imageUrl && (
          <div className="mt-3 rounded-md overflow-hidden bg-muted">
            <img src={post.imageUrl} alt="Post attachment" className="max-h-96 w-auto object-cover" />
          </div>
        )}
      </CardContent>
      <CardFooter className="p-4 pt-0 border-t border-border/50 bg-muted/20 flex items-center justify-between">
        <Button 
          variant="ghost" 
          size="sm" 
          className={`gap-1.5 rounded-full ${post.likedByMe ? "text-destructive hover:text-destructive hover:bg-destructive/10" : "text-muted-foreground hover:text-foreground"}`}
          onClick={handleLikeToggle}
          disabled={likePost.isPending || unlikePost.isPending}
        >
          <Heart className={`h-4 w-4 ${post.likedByMe ? "fill-current" : ""}`} />
          <span className="font-medium">{post.likeCount}</span>
        </Button>
      </CardFooter>
    </Card>
  );
}
