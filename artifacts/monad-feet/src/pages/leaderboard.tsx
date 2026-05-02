import { useGetLeaderboard } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trophy, Medal, Flame } from "lucide-react";

export default function Leaderboard() {
  const { data: leaderboard, isLoading } = useGetLeaderboard();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-yellow-100 text-yellow-600 rounded-lg">
          <Trophy className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
          <p className="text-muted-foreground">Top community members by streak points</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading ranks...</div>
          ) : !leaderboard || leaderboard.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No data available.</div>
          ) : (
            <div className="divide-y">
              {leaderboard.map((entry, idx) => (
                <div key={entry.userId} className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-8 text-center font-bold text-lg text-muted-foreground flex justify-center">
                      {idx === 0 ? <Medal className="h-6 w-6 text-yellow-500" /> : 
                       idx === 1 ? <Medal className="h-6 w-6 text-slate-400" /> : 
                       idx === 2 ? <Medal className="h-6 w-6 text-amber-700" /> : 
                       `#${entry.rank}`}
                    </div>
                    <Link href={`/profile/${entry.userId}`}>
                      <Avatar className="h-10 w-10 cursor-pointer">
                        <AvatarImage src={entry.avatarUrl || ""} />
                        <AvatarFallback>{entry.name?.slice(0,2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                    </Link>
                    <div className="flex flex-col">
                      <Link href={`/profile/${entry.userId}`} className="font-semibold text-sm hover:underline">
                        {entry.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">@{entry.username}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6 text-right">
                    <div className="hidden sm:flex flex-col items-center">
                      <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                        <Flame className="h-3 w-3 text-orange-500" /> Streak
                      </span>
                      <span className="font-semibold">{entry.currentStreak}</span>
                    </div>
                    <div className="flex flex-col items-center min-w-[80px]">
                      <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                        <Trophy className="h-3 w-3 text-primary" /> Points
                      </span>
                      <span className="font-bold text-lg text-primary">{entry.totalPoints}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
