var Request = require("sdk/request").Request;
var { ToggleButton } = require("sdk/ui/button/toggle");
var tabs = require("sdk/tabs");
var notifications = require("sdk/notifications");
var ss = require("sdk/simple-storage");
var prefs = require("sdk/simple-prefs").prefs;
var liveModeration = 0;

function modAction(){
	var latestRequest = Request({
		url: "https://support.mozilla.org/api/2/question/?ordering=-id&format=json&is_spam=False&is_locked=False",
		onComplete: function (response) {
			var latestsumoquestionid = response.json.results[0].id;
			if (ss.storage.lastpage < latestsumoquestionid || !ss.storage.lastpage){
				
				/*start fresh if no prior threads were looked at or they are too out of date*/
				if (!ss.storage.lastpage || latestsumoquestionid - ss.storage.lastpage > 13 ){				
					var sumoquestionid = response.json.results[0].id;
					var sumoquestioncreator = response.json.results[0].creator;
					var sumoquestiontitle = response.json.results[0].title;
					}
				
				/*find the oldest thread not looked at yet and increase id by one*/
				if (ss.storage.lastpage < latestsumoquestionid && latestsumoquestionid - ss.storage.lastpage < 13 ){
					for(var i = 0; i < response.json.results.length; i++)
					{
					  if(response.json.results[i].id == ss.storage.lastpage)
					  {
						var sumoquestionid = response.json.results[i-1].id;
						var sumoquestioncreator = response.json.results[i-1].creator;
						var sumoquestiontitle = response.json.results[i-1].title;
					  }
					}
				}
				
				/*query for recent posts of this user*/
				function getCount(user) {
					var count = 0;
					for (var i = 0; i < response.json.results.length; i++) {
						if (response.json.results[i].creator == user) {
							count++;
						}
					}
					return count;
				}
			
				console.log("Question now under scrutiny is: " + sumoquestionid);
				var evaluateRequest = Request({
					url: "https://support.mozilla.org/api/2/question/" + sumoquestionid + "?format=json",
						onComplete: function (response2) {
							var sumoquestioncontent = response2.json.content;
							 
							/*testnumber of different letters in a question*/
							var str = sumoquestioncontent;
							var uniq = '';
							for (var i = 0; i< str.length; i++) {
							 if(uniq.indexOf( str[i] ) == -1){
							   uniq += str[i];
							 }
							}
							
							/*suspicious content*/
							if (prefs.alertkeyword == true && RegExp("(season|episode)[\W]?\d|" + prefs.keywords, "i").test(sumoquestioncontent)==true || prefs.alertkeyword == true && RegExp(prefs.keywords, "i").test(sumoquestiontitle)==true ){
								tabs.open({
								  url: "https://support.mozilla.org/questions/" + sumoquestionid,
								  inBackground: prefs.alertinbackground
								});
								notifications.notify({
								  title: "SUMO: Moderation needed?",
								  text: "contains spammy keywords",
								  data: "",
								});
							}
							else if (prefs.alertphonenumberlink == true && sumoquestioncontent.search(/\(?\b([0-9O]{3})\)?[-. ]?([0-9O]{3})[-. ]?([0-9O]{4})\b/) != -1 || prefs.alertphonenumberlink == true && sumoquestiontitle.search(/\(?\b([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/) != -1){
								tabs.open({
								  url: "https://support.mozilla.org/questions/" + sumoquestionid,
								  inBackground: prefs.alertinbackground
								});
								tabs.open("https://support.mozilla.org/questions/" + sumoquestionid);
								notifications.notify({
								  title: "SUMO: Moderation needed?",
								  text: "contains phone number",
								  data: "",
								});
							}						
							else if (prefs.alertphonenumberlink == true && sumoquestioncontent.search(/\b((https?|ftp|file):\/\/)?[a-z0-9]*[.][a-z]*\/[a-z0-9]+/) != -1 && sumoquestioncontent.search(/[:./ \s]mozilla.(org|com)/) == -1 || prefs.alertphonenumberlink == true && sumoquestiontitle.search(/\b((https?|ftp|file):\/\/)?[a-z0-9]*[.][a-z]*\/[a-z0-9]+/) != -1 && sumoquestioncontent.search(/[:./ \s]mozilla.(org|com)/) == -1){
								tabs.open({
								  url: "https://support.mozilla.org/questions/" + sumoquestionid,
								  inBackground: prefs.alertinbackground
								});
								notifications.notify({
								  title: "SUMO: Moderation needed?",
								  text: "contains link",
								  data: "",
								});
							}
							else if (prefs.alertgarbled == true && sumoquestioncontent.length < 10 || prefs.alertgarbled == true && sumoquestiontitle.length < 10){
								tabs.open({
								  url: "https://support.mozilla.org/questions/" + sumoquestionid,
								  inBackground: prefs.alertinbackground
								});
								notifications.notify({
								  title: "SUMO: Moderation needed?",
								  text: "contains little content",
								  data: "",
								});
								console.log("little content, question length is " + sumoquestiontitle.length + " & content length is "+ sumoquestioncontent.length);
							}
							else if (prefs.alertgarbled == true && uniq.length < 6){
								tabs.open({
								  url: "https://support.mozilla.org/questions/" + sumoquestionid,
								  inBackground: prefs.alertinbackground
								});
								notifications.notify({
								  title: "SUMO: Moderation needed?",
								  text: "contains garbled content",
								  data: "",
								});
								console.log("garbled content, only " + uniq.length + " letters used");
							}
							else if (prefs.alertduplicate == true && getCount(sumoquestioncreator) > 1){
								function duplicatealertexisting(){
									for(var i = 0; i < tabs.length; i++){
										var url = require("sdk/url").URL(tabs[i].url);
										if(url.search == "?a=1&asked_by=" + sumoquestioncreator + "&sortby=1&w=2"){
											tabs[i].reload();
											if (prefs.alertinbackground == false){
												tabs[i].activate();
											}
											return true;
										}
										else{
										return false;
										}
									}
								}
								duplicatealertexisting();
								if (duplicatealertexisting() === false){
									tabs.open({
									url: "https://support.mozilla.org/en-us/search?a=1&asked_by=" + sumoquestioncreator + "&sortby=1&w=2",
									inBackground: prefs.alertinbackground
									});
								}
								notifications.notify({
								  title: "SUMO: Moderation needed?",
								  text: "possible duplicate",
								  data: "",
								});
								
							}
							
							/*non-suspicious content*/
							else if (prefs.verbose == true){
								console.log("not spammy");
								notifications.notify({
								  title: "SUMO - " + sumoquestioncreator + " posted:",
								  text: sumoquestiontitle,
								  data: "",
								  onClick: function (data) {
									tabs.open("https://support.mozilla.org/questions/" + sumoquestionid);
								  }
								});
						}
					}
				});
			evaluateRequest.get();
			ss.storage.lastpage = sumoquestionid;
			if (ss.storage.lastpage < latestsumoquestionid){ 
				require('sdk/timers').setTimeout(modAction,5000); }
			}
			
			else if (ss.storage.lastpage == latestsumoquestionid){
				console.log("already seen question " + latestsumoquestionid + " - no action required");
			}
		}
	});
	latestRequest.get();
};

/*toolbar toggle button*/
var button = ToggleButton({
    id: "sumo-live-mod-button",
    label: "SUMO Live Moderation",
    icon: {
      "16": "./icon-16.png",
      "32": "./icon-32.png",
	  "64": "./icon-64.png"
    },
    onChange: function(state) {
		if (state.checked == true){
		ss.storage.mod_enabled = true;
		button.label = "SUMO Live Moderation: on";
		modAction()
		liveModeration = require('sdk/timers').setInterval(modAction,prefs.polling*1000);		
		console.log("Moderation on");
				}
        else if (state.checked == false){
		ss.storage.mod_enabled = false;
		button.label = "SUMO Live Moderation: off";
		require('sdk/timers').clearInterval(liveModeration);
		console.log("Moderation off");
		}
    }
  });
  
  /*set intial state*/
if (ss.storage.mod_enabled == true){
	button.label = "SUMO Live Moderation: on";
	button.checked = true;
	console.log("Moderation on");
};

/*listen for changes to settings*/
require("sdk/simple-prefs").on("", changePolling);
function changePolling(Prefname){
	if (ss.storage.mod_enabled == true){
		require('sdk/timers').clearInterval(liveModeration);	
		liveModeration = require('sdk/timers').setInterval(modAction,prefs.polling*1000);
		console.log(Prefname + " has now changed state");
	}
};