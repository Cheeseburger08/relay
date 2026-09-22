package app.relay.companion;

final class RecoveryWindow {
    String callId="";
    long deadline;
    void start(String id,long now,long remaining) {
        long next=now+Math.max(0,Math.min(60000,remaining));
        if(!id.equals(callId)||deadline==0){callId=id;deadline=next;}
        else deadline=Math.min(deadline,next);
    }
    void clear(){callId="";deadline=0;}
}
