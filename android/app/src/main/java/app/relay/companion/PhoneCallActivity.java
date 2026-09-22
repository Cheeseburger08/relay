package app.relay.companion;
import android.app.Activity;
import android.os.*;
import android.telecom.Call;
import android.widget.*;

public class PhoneCallActivity extends Activity {
    private final Handler handler=new Handler(Looper.getMainLooper());
    private TextView status;
    private final Runnable refresh=new Runnable(){public void run(){
        Call call=RelayInCallService.current;if(call==null){finish();return;}
        String number=call.getDetails().getHandle()==null?"Unknown caller":call.getDetails().getHandle().getSchemeSpecificPart();
        status.setText(number+"\n"+(call.getState()==Call.STATE_RINGING?"Incoming call":call.getState()==Call.STATE_ACTIVE?"Connected":"Call in progress"));handler.postDelayed(this,500);
    }};
    @Override public void onCreate(Bundle state){super.onCreate(state);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE|android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(32,48,32,24);setContentView(box);
        status=new TextView(this);status.setTextSize(26);box.addView(status);
        Button answer=new Button(this);answer.setText("Answer on phone");box.addView(answer);answer.setOnClickListener(v->{if(RelayInCallService.current!=null)RelayInCallService.current.answer(0);});
        Button end=new Button(this);end.setText("End call");box.addView(end);end.setOnClickListener(v->{if(RelayInCallService.current!=null)RelayInCallService.current.disconnect();});
        Button waiting=new Button(this);waiting.setText("Answer waiting call / resume held call");box.addView(waiting);waiting.setOnClickListener(v->{for(Call c:RelayInCallService.all.keySet()){if(c.getState()==Call.STATE_RINGING){c.answer(0);return;}if(c.getState()==Call.STATE_HOLDING){c.unhold();return;}}});
        for(String row:new String[]{"123","456","789","*0#"}){LinearLayout buttons=new LinearLayout(this);box.addView(buttons);for(char digit:row.toCharArray()){Button b=new Button(this);b.setText(String.valueOf(digit));buttons.addView(b,new LinearLayout.LayoutParams(0,-2,1));b.setOnClickListener(v->{Call call=RelayInCallService.current;if(call!=null){call.playDtmfTone(digit);handler.postDelayed(call::stopDtmfTone,150);}});}}
    }
    @Override public void onResume(){super.onResume();handler.post(refresh);}
    @Override public void onPause(){handler.removeCallbacksAndMessages(null);if(RelayInCallService.current!=null)RelayInCallService.current.stopDtmfTone();super.onPause();}
}
