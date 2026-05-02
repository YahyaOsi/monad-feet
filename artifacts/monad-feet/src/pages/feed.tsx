import { useState } from "react";
import { Link } from "wouter";
import { useUser } from "@/context/UserContext";
import { useListPosts, useGetFeedSummary, useCreatePost } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PostCard } from "@/components/post/PostCard";
import { Plus, Users, Heart, MessageSquare } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListPostsQueryKey, getGetFeedSummaryQueryKey } from "@workspace/api-client-react";

export default function Feed() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { data: feedPage, isLoading: feedLoading } = useListPosts({});
  const { data: summary } = useGetFeedSummary();
  const createPost = useCreatePost();
  
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [content, setContent] = useState("");

  const handleCreatePost = async () => {
    if (!content.trim() || !user) return;
    try {
      await createPost.mutateAsync({
        data: {
          content,
          authorWalletAddress: user.walletAddress
        }
      });
      setIsComposeOpen(false);
      setContent("");
      queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetFeedSummaryQueryKey() });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Feed</h1>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-primary/5 border-none shadow-none">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-full text-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Posts</p>
                <p className="text-2xl font-bold">{summary.totalPosts}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-none shadow-none">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-full text-primary">
                <Heart className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Likes</p>
                <p className="text-2xl font-bold">{summary.totalLikes}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-none shadow-none">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-full text-primary">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Today</p>
                <p className="text-2xl font-bold">{summary.activeToday}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-4">
        {feedLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="h-32 p-6" />
              </Card>
            ))}
          </div>
        ) : feedPage?.posts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No posts yet. Be the first to post!
          </div>
        ) : (
          feedPage?.posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))
        )}
      </div>

      <Dialog open={isComposeOpen} onOpenChange={setIsComposeOpen}>
        <DialogTrigger asChild>
          <Button size="icon" className="fixed bottom-20 md:bottom-8 right-4 md:right-8 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all">
            <Plus className="h-6 w-6" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create a Post</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <Textarea
              placeholder="What's happening in the Monad ecosystem?"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[150px] resize-none text-lg"
            />
            <div className="flex justify-end">
              <Button onClick={handleCreatePost} disabled={!content.trim() || createPost.isPending}>
                {createPost.isPending ? "Posting..." : "Post"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
